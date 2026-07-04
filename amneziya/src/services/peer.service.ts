import QRCode from "qrcode";
import { config } from "../config.js";
import { db } from "../db/database.js";
import { findFreeIp, normalizeAllowedIp } from "../lib/ip.js";
import { configWriteLock } from "../lib/lock.js";
import { actionLogRepository } from "../repositories/action-log.repository.js";
import { peerRepository, type PeerRecord } from "../repositories/peer.repository.js";
import { awgService, type AwgRuntimePeer } from "./awg.service.js";
import { configFileService } from "./config-file.service.js";
import { buildPeerResponse } from "./peer-response.js";

export class PeerService {
  async list(includeDeleted = false) {
    await this.importRuntimePeers();
    const runtimeByPublicKey = await this.runtimeByPublicKey();
    return peerRepository.findAll(includeDeleted).map((peer) =>
      buildPeerResponse(peer, runtimeByPublicKey.get(peer.publicKey) ?? null, peerRepository.findTraffic(peer.id))
    );
  }

  async create(data: { client: string; expiresAt?: string | null; trafficLimitBytes?: number | null }) {
    return configWriteLock.run(async () => {
      const existing = peerRepository.findByClient(data.client);
      if (existing) {
        const updated = peerRepository.updateLimits(existing.id, {
          expiresAt: Object.hasOwn(data, "expiresAt") ? data.expiresAt ?? null : undefined,
          trafficLimitBytes: Object.hasOwn(data, "trafficLimitBytes") ? data.trafficLimitBytes ?? null : undefined
        });
        actionLogRepository.create({
          action: "peer_returned_existing",
          client: updated.client,
          peerId: updated.id,
          payload: { expiresAt: updated.expiresAt, trafficLimitBytes: updated.trafficLimitBytes }
        });
        return { ...this.withRuntime(updated), alreadyExists: true, config: updated.configText };
      }

      const runtimePeers = await awgService.dumpPeers();
      const dbPeers = peerRepository.findAll(true);
      const usedIps = new Set<string>([
        ...runtimePeers.map((peer) => normalizeAllowedIp(peer.allowedIps)),
        ...dbPeers.filter((peer) => peer.deletedAt === null).map((peer) => normalizeAllowedIp(peer.assignedIp))
      ]);
      const assignedIp = findFreeIp(config.amnezia.clientCidr, usedIps);

      const privateKey = await awgService.generatePrivateKey();
      const publicKey = await awgService.publicKeyFromPrivate(privateKey);
      const presharedKey = await awgService.generatePresharedKey();
      const serverPublicKey = await awgService.getServerPublicKey();
      const interfaceSettings = configFileService.parseInterfaceSettings();

      const clientConfig = buildClientConfig({
        privateKey,
        assignedIp,
        presharedKey,
        serverPublicKey,
        interfaceExtras: interfaceSettings.extras
      });
      const serverPeerBlock = buildServerPeerBlock({
        client: data.client,
        publicKey,
        presharedKey,
        assignedIp
      });

      const before = configFileService.read();
      configFileService.write(configFileService.appendPeerBlock(before, serverPeerBlock));
      await awgService.applyConfig();

      const peer = peerRepository.create({
        client: data.client,
        publicKey,
        privateKey,
        presharedKey,
        assignedIp,
        configText: clientConfig,
        enabled: true,
        expiresAt: data.expiresAt ?? null,
        trafficLimitBytes: data.trafficLimitBytes ?? null
      });
      peerRepository.upsertTraffic(peer.id, 0, 0, new Date().toISOString());
      actionLogRepository.create({
        action: "peer_created",
        client: data.client,
        peerId: peer.id,
        payload: { assignedIp, expiresAt: peer.expiresAt, trafficLimitBytes: peer.trafficLimitBytes }
      });

      return { ...this.withRuntime(peer), alreadyExists: false, config: clientConfig };
    });
  }

  async getByPublicKey(publicKey: string) {
    await this.importRuntimePeers();
    const peer = peerRepository.findByPublicKey(publicKey);
    return peer ? this.withRuntime(peer) : null;
  }

  async getRecordByPublicKey(publicKey: string): Promise<PeerRecord | null> {
    await this.importRuntimePeers();
    return peerRepository.findByPublicKey(publicKey);
  }

  async getByClient(client: string) {
    await this.importRuntimePeers();
    const peer = peerRepository.findByClient(client);
    return peer ? this.withRuntime(peer) : null;
  }

  async getRecordByClient(client: string): Promise<PeerRecord | null> {
    await this.importRuntimePeers();
    return peerRepository.findByClient(client);
  }

  getConfig(peer: PeerRecord): string | null {
    actionLogRepository.create({ action: "config_returned", client: peer.client, peerId: peer.id });
    return peer.configText;
  }

  async getQr(peer: PeerRecord): Promise<string | null> {
    if (!peer.configText) return null;
    actionLogRepository.create({ action: "qr_returned", client: peer.client, peerId: peer.id });
    const dataUrl = await QRCode.toDataURL(peer.configText, { type: "image/png", margin: 1 });
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  }

  async updateLimits(peer: PeerRecord, data: { expiresAt?: string | null; trafficLimitBytes?: number | null }) {
    const updated = peerRepository.updateLimits(peer.id, data);
    actionLogRepository.create({
      action: "peer_limits_updated",
      client: updated.client,
      peerId: updated.id,
      payload: { expiresAt: updated.expiresAt, trafficLimitBytes: updated.trafficLimitBytes }
    });
    return this.withRuntime(updated);
  }

  async disable(peer: PeerRecord, reason: string) {
    return configWriteLock.run(async () => {
      await this.removeFromConfig(peer.publicKey);
      const updated = peerRepository.markDisabled(peer.id, reason);
      actionLogRepository.create({ action: "peer_disabled", client: peer.client, peerId: peer.id, reason });
      return this.withRuntime(updated);
    });
  }

  async enable(peer: PeerRecord) {
    return configWriteLock.run(async () => {
      if (!peer.presharedKey) throw new Error("Cannot enable peer without stored preshared key");

      const contents = configFileService.read();
      const withoutPeer = configFileService.removePeerBlock(contents, peer.publicKey);
      const withPeer = configFileService.appendPeerBlock(
        withoutPeer,
        buildServerPeerBlock({
          client: peer.client ?? "manual",
          publicKey: peer.publicKey,
          presharedKey: peer.presharedKey,
          assignedIp: peer.assignedIp
        })
      );
      configFileService.write(withPeer);
      await awgService.applyConfig();

      const updated = peerRepository.markEnabled(peer.id);
      actionLogRepository.create({ action: "peer_enabled", client: peer.client, peerId: peer.id });
      return this.withRuntime(updated);
    });
  }

  async delete(peer: PeerRecord) {
    return configWriteLock.run(async () => {
      await this.removeFromConfig(peer.publicKey);
      const updated = peerRepository.markDeleted(peer.id);
      actionLogRepository.create({ action: "peer_deleted", client: peer.client, peerId: peer.id, reason: "deleted" });
      return this.withRuntime(updated);
    });
  }

  async sampleTraffic(): Promise<void> {
    const sampledAt = new Date().toISOString();
    const runtimePeers = await awgService.dumpPeers();

    db.exec("BEGIN");
    try {
      for (const runtime of runtimePeers) {
        const peer = peerRepository.ensureManualPeer(runtime.publicKey, normalizeAllowedIp(runtime.allowedIps));
        const traffic = peerRepository.upsertTraffic(peer.id, runtime.rxBytes, runtime.txBytes, sampledAt);
        actionLogRepository.create({
          action: "traffic_sampled",
          client: peer.client,
          peerId: peer.id,
          payload: { totalRxBytes: traffic.totalRxBytes, totalTxBytes: traffic.totalTxBytes }
        });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    await this.disableOverLimitPeers();
  }

  async disableExpiredPeers(): Promise<void> {
    const now = new Date().toISOString();
    const expired = peerRepository
      .findAll()
      .filter((peer) => peer.enabled && peer.expiresAt !== null && peer.expiresAt <= now);

    for (const peer of expired) {
      await this.autoDisable(peer, "expired_at");
    }
  }

  private async disableOverLimitPeers(): Promise<void> {
    const peers = peerRepository.findAll().filter((peer) => peer.enabled && peer.trafficLimitBytes !== null);
    for (const peer of peers) {
      const traffic = peerRepository.findTraffic(peer.id);
      const used = (traffic?.totalRxBytes ?? 0) + (traffic?.totalTxBytes ?? 0);
      if (peer.trafficLimitBytes !== null && used >= peer.trafficLimitBytes) {
        await this.autoDisable(peer, "traffic_limit", { trafficUsedBytes: used, trafficLimitBytes: peer.trafficLimitBytes });
      }
    }
  }

  private async autoDisable(peer: PeerRecord, reason: string, payload?: unknown): Promise<void> {
    await configWriteLock.run(async () => {
      const fresh = peerRepository.findById(peer.id);
      if (!fresh || !fresh.enabled || fresh.deletedAt !== null) return;

      await this.removeFromConfig(fresh.publicKey);
      peerRepository.markDisabled(fresh.id, reason);
      actionLogRepository.create({
        action: "peer_auto_disabled",
        client: fresh.client,
        peerId: fresh.id,
        reason,
        payload
      });
    });
  }

  private async removeFromConfig(publicKey: string): Promise<void> {
    const before = configFileService.read();
    const after = configFileService.removePeerBlock(before, publicKey);
    if (after !== before) {
      configFileService.write(after);
      await awgService.applyConfig();
    }
  }

  private async importRuntimePeers(): Promise<void> {
    const runtimePeers = await awgService.dumpPeers();
    for (const runtime of runtimePeers) {
      peerRepository.ensureManualPeer(runtime.publicKey, normalizeAllowedIp(runtime.allowedIps));
    }
  }

  private async runtimeByPublicKey(): Promise<Map<string, AwgRuntimePeer>> {
    return new Map((await awgService.dumpPeers()).map((peer) => [peer.publicKey, peer]));
  }

  private withRuntime(peer: PeerRecord) {
    const traffic = peerRepository.findTraffic(peer.id);
    return buildPeerResponse(peer, null, traffic);
  }
}

function buildServerPeerBlock(data: { client: string; publicKey: string; presharedKey: string; assignedIp: string }): string {
  return [
    `# amneziya-agent client=${data.client} createdAt=${new Date().toISOString()}`,
    "[Peer]",
    `PublicKey = ${data.publicKey}`,
    `PresharedKey = ${data.presharedKey}`,
    `AllowedIPs = ${data.assignedIp}`
  ].join("\n");
}

function buildClientConfig(data: {
  privateKey: string;
  assignedIp: string;
  presharedKey: string;
  serverPublicKey: string;
  interfaceExtras: Record<string, string>;
}): string {
  const interfaceLines = [
    "[Interface]",
    `PrivateKey = ${data.privateKey}`,
    `Address = ${data.assignedIp}`,
    `DNS = ${config.amnezia.dns}`
  ];
  if (config.amnezia.mtu > 0) {
    interfaceLines.push(`MTU = ${config.amnezia.mtu}`);
  }

  for (const key of ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4"]) {
    const value = data.interfaceExtras[key];
    if (value) interfaceLines.push(`${key} = ${value}`);
  }

  return [
    ...interfaceLines,
    "",
    "[Peer]",
    `PublicKey = ${data.serverPublicKey}`,
    `PresharedKey = ${data.presharedKey}`,
    `Endpoint = ${config.amnezia.serverHost}:${config.amnezia.serverPort}`,
    "AllowedIPs = 0.0.0.0/0",
    `PersistentKeepalive = ${config.amnezia.persistentKeepalive}`,
    ""
  ].join("\n");
}

export const peerService = new PeerService();
