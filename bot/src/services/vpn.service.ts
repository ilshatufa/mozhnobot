import { VpnProvider, type User, type VpnKey, type VpnServer } from "@prisma/client";
import { config, type XuiServerConfig } from "../config.js";
import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { vpnServerRepository } from "../repositories/vpn-server.repository.js";
import { amneziyaClient, type AmneziyaPeer } from "./amneziya-client.js";
import { xuiClient } from "./xui-client.js";

export interface VpnKeyResult {
  key: VpnKey;
  alreadyExisted: boolean;
}

export interface AmneziyaKeyResult extends VpnKeyResult {
  configText: string;
  qrPngBase64: string;
  configFileName: string;
}

export interface AmneziyaConfigFile {
  serverCode: string;
  serverName: string;
  key: VpnKey;
  alreadyExisted: boolean;
  configText: string;
  configFileName: string;
}

function expiresAtFromNow(user: User): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + user.vpnDurationDays);
  return expiresAt;
}

function trafficLimitBytes(user: User): bigint | null {
  return user.vpnTrafficLimitBytes;
}

function isXuiRecordNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("record not found");
}

export class VpnService {
  async getOrCreateKey(user: User): Promise<VpnKeyResult> {
    return this.getOrCreateXuiKey(user);
  }

  async listAmneziyaServers(): Promise<VpnServer[]> {
    return vpnServerRepository.findActiveManyByProvider(VpnProvider.AMNEZIA);
  }

  async listXuiServers(): Promise<VpnServer[]> {
    return vpnServerRepository.findActiveManyByProvider(VpnProvider.XUI);
  }

  async getOrCreateXuiKey(user: User, serverCode = config.vpnServers.xui.code): Promise<VpnKeyResult> {
    const serverConfig = this.requireXuiServerConfig(serverCode);
    const server = await this.requireServer(serverConfig.code, VpnProvider.XUI);
    const existingForServer = await vpnKeyRepository.findActiveByUserAndServer(user.id, server.id);
    const existingLegacy = existingForServer || serverConfig.code !== config.vpnServers.xui.code
      ? null
      : await vpnKeyRepository.findActiveLegacyXuiByUser(user.id);
    const existing = existingForServer ?? existingLegacy;
    const xuiEmail = xuiClient.buildClientEmail(user.telegramId, user.username);

    if (existing) {
      const attached = existing.serverId === server.id
        ? existing
        : await vpnKeyRepository.attachServer(existing.id, { serverId: server.id, provider: VpnProvider.XUI });
      let subId = existing.subId ?? "";
      let xuiClientId = existing.xuiClientId;
      let providerPeerId = existing.providerPeerId ?? existing.xuiClientId;
      const limitBytes = trafficLimitBytes(user);

      try {
        // Backfill legacy keys without random subId by rotating to a new random one.
        if (!subId) {
          subId = xuiClient.generateSubId();
        }

        // Keep XUI client email aligned with current username format.
        await xuiClient.updateClientSubscription(
          serverConfig,
          xuiClientId,
          existing.providerClientId ?? xuiEmail,
          xuiEmail,
          existing.expiresAt.getTime(),
          subId,
          limitBytes
        );
      } catch (err) {
        if (!isXuiRecordNotFoundError(err)) throw err;

        const created = await xuiClient.addClient(
          serverConfig,
          user.telegramId,
          user.username,
          existing.expiresAt.getTime(),
          limitBytes
        );
        xuiClientId = created.clientId;
        providerPeerId = created.clientId;
        subId = created.subId;
        logger.warn(`3X-UI ${serverConfig.code} client ${existing.xuiClientId} was missing, recreated as ${xuiClientId}`);
      }

      const actualSubscriptionUrl = xuiClient.getSubscriptionUrl(serverConfig, subId);

      if (
        existing.xuiClientId !== xuiClientId ||
        existing.subscriptionUrl !== actualSubscriptionUrl ||
        existing.subId !== subId ||
        existing.providerClientId !== xuiEmail ||
        existing.providerPeerId !== providerPeerId ||
        existing.trafficLimitBytes !== limitBytes
      ) {
        const updated = await vpnKeyRepository.updateXuiSubscription(attached.id, {
          xuiClientId,
          providerClientId: xuiEmail,
          providerPeerId,
          subId,
          subscriptionUrl: actualSubscriptionUrl,
          trafficLimitBytes: limitBytes,
        });
        return { key: updated, alreadyExisted: true };
      }

      return { key: attached, alreadyExisted: true };
    }

    const expiresAt = expiresAtFromNow(user);
    const expiryTime = expiresAt.getTime();
    const limitBytes = trafficLimitBytes(user);

    const { clientId, subId } = await xuiClient.addClient(
      serverConfig,
      user.telegramId,
      user.username,
      expiryTime,
      limitBytes
    );
    const subscriptionUrl = xuiClient.getSubscriptionUrl(serverConfig, subId);

    const key = await vpnKeyRepository.create({
      userId: user.id,
      serverId: server.id,
      provider: VpnProvider.XUI,
      xuiClientId: clientId,
      providerClientId: xuiEmail,
      providerPeerId: clientId,
      subId,
      subscriptionUrl,
      trafficLimitBytes: limitBytes,
      expiresAt,
    });

    logger.info(`VPN key created for user ${user.telegramId}, expires ${expiresAt.toISOString()}`);

    return { key, alreadyExisted: false };
  }

  async getOrCreateMultiXuiKey(user: User): Promise<VpnKeyResult> {
    const activeServers = await this.listXuiServers();
    const activeConfigs = activeServers
      .map((server) => config.vpnServers.xui.servers.find((item) => item.code === server.code))
      .filter((server): server is XuiServerConfig => Boolean(server));

    if (activeConfigs.length === 0) {
      throw new Error("No active 3X-UI servers are configured");
    }

    if (activeConfigs.length === 1) {
      return this.getOrCreateXuiKey(user, activeConfigs[0].code);
    }

    const aggregator = config.vpnServers.xui.multiServerCode
      ? activeConfigs.find((server) => server.code === config.vpnServers.xui.multiServerCode)
      : activeConfigs.find((server) => server.clientApiMode === "clients");
    if (!aggregator) {
      throw new Error("No 3X-UI server with clients API is configured for multi-server subscription");
    }
    if (aggregator.clientApiMode !== "clients") {
      throw new Error(`3X-UI aggregator ${aggregator.code} does not support clients API`);
    }

    const results = [];
    for (const server of activeConfigs) {
      results.push({
        server,
        result: await this.getOrCreateXuiKey(user, server.code),
      });
    }

    const aggregatorResult = results.find((item) => item.server.code === aggregator.code);
    if (!aggregatorResult) {
      throw new Error(`3X-UI aggregator ${aggregator.code} key was not created`);
    }

    const externalLinks: string[] = [];
    for (const item of results) {
      if (item.server.code === aggregator.code) continue;
      const links = await xuiClient.fetchSubscriptionLinks(item.result.key.subscriptionUrl);
      externalLinks.push(...this.filterOwnXuiLinks(item.server, links));
    }

    const aggregatorEmail = aggregatorResult.result.key.providerClientId
      ?? xuiClient.buildClientEmail(user.telegramId, user.username);
    await xuiClient.updateExternalLinks(aggregator, aggregatorEmail, externalLinks);

    let subscriptionKey = aggregatorResult.result.key;
    const publicMultiSubBaseUrl = config.vpnServers.xui.multiSubBaseUrl;
    if (publicMultiSubBaseUrl && subscriptionKey.subId) {
      const publicSubscriptionUrl = `${publicMultiSubBaseUrl.replace(/\/+$/, "")}/sub/${subscriptionKey.subId}`;
      if (subscriptionKey.subscriptionUrl !== publicSubscriptionUrl) {
        subscriptionKey = await vpnKeyRepository.updateXuiSubscription(subscriptionKey.id, {
          xuiClientId: subscriptionKey.xuiClientId,
          providerClientId: subscriptionKey.providerClientId ?? aggregatorEmail,
          providerPeerId: subscriptionKey.providerPeerId,
          subId: subscriptionKey.subId,
          subscriptionUrl: publicSubscriptionUrl,
          trafficLimitBytes: subscriptionKey.trafficLimitBytes,
        });
      }
    }

    logger.info(`Multi-server 3X-UI subscription updated for user ${user.telegramId}`, {
      aggregator: aggregator.code,
      servers: activeConfigs.map((server) => server.code),
      externalLinks: externalLinks.length,
    });

    return {
      key: subscriptionKey,
      alreadyExisted: results.every((item) => item.result.alreadyExisted),
    };
  }

  async getOrCreateAmneziyaKey(user: User, serverCode = config.vpnServers.amneziya.code): Promise<AmneziyaKeyResult> {
    const server = await this.requireServer(serverCode, VpnProvider.AMNEZIA);
    const active = await vpnKeyRepository.findActiveByUserAndServer(user.id, server.id);
    const existing = active
      ?? await vpnKeyRepository.findLatestByUserAndServer(user.id, server.id, VpnProvider.AMNEZIA);
    const client = amneziyaClient.buildClientId(user.telegramId);
    const limitBytes = trafficLimitBytes(user);

    if (existing) {
      const now = new Date();
      const expiresAt = existing.expiresAt > now ? existing.expiresAt : expiresAtFromNow(user);
      let peer = await amneziyaClient.createPeer(server, {
        client,
        expiresAt,
        trafficLimitBytes: null,
      });
      const peerConfig = peer.config;
      peer = await this.ensureAmneziyaPeerEnabled(server, client, peer);

      const [configText, qrPngBase64] = await Promise.all([
        existing.configText ? Promise.resolve(existing.configText) : peerConfig ? Promise.resolve(peerConfig) : amneziyaClient.getConfig(server, client),
        existing.qrPngBase64 ? Promise.resolve(existing.qrPngBase64) : amneziyaClient.getQrPngBase64(server, client),
      ]);
      const updated = await vpnKeyRepository.updateAmneziyaData(existing.id, {
        providerClientId: client,
        providerPeerId: peer.peerId,
        configText,
        qrPngBase64,
        trafficLimitBytes: limitBytes,
        trafficUsedBytes: BigInt(peer.trafficUsedBytes),
        disabledReason: peer.disabledReason,
        isActive: peer.enabled && !peer.deleted,
        expiresAt: peer.expiresAt ? new Date(peer.expiresAt) : expiresAt,
        lastSyncedAt: new Date(),
      });

      return {
        key: updated,
        alreadyExisted: true,
        configText,
        qrPngBase64,
        configFileName: amneziyaClient.buildConfigFileName(server.code),
      };
    }

    const expiresAt = expiresAtFromNow(user);
    let peer = await amneziyaClient.createPeer(server, {
      client,
      expiresAt,
      trafficLimitBytes: null,
    });
    const peerConfig = peer.config;
    peer = await this.ensureAmneziyaPeerEnabled(server, client, peer);
    const [configText, qrPngBase64] = await Promise.all([
      peerConfig ? Promise.resolve(peerConfig) : amneziyaClient.getConfig(server, client),
      amneziyaClient.getQrPngBase64(server, client),
    ]);

    const key = await vpnKeyRepository.create({
      userId: user.id,
      serverId: server.id,
      provider: VpnProvider.AMNEZIA,
      xuiClientId: peer.peerId,
      providerClientId: client,
      providerPeerId: peer.peerId,
      subscriptionUrl: server.apiBaseUrl,
      configText,
      qrPngBase64,
      trafficLimitBytes: limitBytes,
      trafficUsedBytes: BigInt(peer.trafficUsedBytes),
      disabledReason: peer.disabledReason,
      lastSyncedAt: new Date(),
      expiresAt: peer.expiresAt ? new Date(peer.expiresAt) : expiresAt,
    });

    logger.info(`Amnezia key created for user ${user.telegramId}, expires ${expiresAt.toISOString()}`);

    return {
      key,
      alreadyExisted: false,
      configText,
      qrPngBase64,
      configFileName: amneziyaClient.buildConfigFileName(server.code),
    };
  }

  async getOrCreateAllAmneziyaConfigs(user: User): Promise<AmneziyaConfigFile[]> {
    const servers = await this.listAmneziyaServers();
    if (servers.length === 0) {
      throw new Error("No active Amnezia servers are configured");
    }

    const result: AmneziyaConfigFile[] = [];
    for (const server of servers) {
      const item = await this.getOrCreateAmneziyaKey(user, server.code);
      result.push({
        serverCode: server.code,
        serverName: server.name,
        key: item.key,
        alreadyExisted: item.alreadyExisted,
        configText: item.configText,
        configFileName: item.configFileName,
      });
    }

    return result;
  }

  async disableKeysForUser(user: User): Promise<void> {
    const activeKeys = await vpnKeyRepository.findActiveManyByUserId(user.id);

    for (const activeKey of activeKeys) {
      try {
        if (activeKey.provider === VpnProvider.AMNEZIA && activeKey.providerClientId) {
          await amneziyaClient.disablePeer(activeKey.server, activeKey.providerClientId, "blocked");
        } else {
          const serverConfig = this.requireXuiServerConfig(activeKey.server?.code ?? config.vpnServers.xui.code);
          const xuiEmail = activeKey.providerClientId ?? xuiClient.buildClientEmail(user.telegramId, user.username);
          await xuiClient.disableClient(serverConfig, activeKey.xuiClientId, xuiEmail);
        }
      } catch (err) {
        logger.warn(`Failed to disable VPN key ${activeKey.id} for user ${user.telegramId}:`, err);
      }
    }

    await vpnKeyRepository.deactivateAllForUser(user.id);
  }

  async getStatus(user: User): Promise<{ status: "active" | "expired" | "none" | "blocked"; key?: VpnKey }> {
    if (user.vpnBlocked) {
      return { status: "blocked" };
    }

    const activeKey = await vpnKeyRepository.findActiveByUserId(user.id);
    if (activeKey) {
      return { status: "active", key: activeKey };
    }

    const latestKey = await vpnKeyRepository.findLatestByUserId(user.id);
    if (latestKey) {
      return { status: "expired", key: latestKey };
    }

    return { status: "none" };
  }

  async getStatuses(user: User): Promise<{
    status: "blocked" | "active" | "none";
    keys: Array<VpnKey & { server: VpnServer | null }>;
  }> {
    if (user.vpnBlocked) {
      return { status: "blocked", keys: [] };
    }

    const keys = await vpnKeyRepository.findActiveManyByUserId(user.id);
    return {
      status: keys.length > 0 ? "active" : "none",
      keys,
    };
  }

  private async requireServer(code: string, provider: VpnProvider): Promise<VpnServer> {
    const server = await vpnServerRepository.findActiveByCode(code);
    if (!server || server.provider !== provider) {
      throw new Error(`VPN server ${code} is not configured`);
    }
    return server;
  }

  private requireXuiServerConfig(code: string): XuiServerConfig {
    const server = config.vpnServers.xui.servers.find((item) => item.code === code);
    if (!server) {
      throw new Error(`3X-UI server ${code} is not configured`);
    }
    return server;
  }

  private async ensureAmneziyaPeerEnabled(
    server: VpnServer,
    client: string,
    peer: AmneziyaPeer
  ): Promise<AmneziyaPeer> {
    if (peer.deleted) {
      throw new Error(`Amnezia peer ${client} on ${server.code} is deleted`);
    }

    if (peer.enabled) {
      return peer;
    }

    if (peer.disabledReason && !["expired_at", "traffic_limit"].includes(peer.disabledReason)) {
      throw new Error(`Amnezia peer ${client} on ${server.code} is disabled: ${peer.disabledReason}`);
    }

    const enabled = await amneziyaClient.enablePeer(server, client);
    logger.info(`Amnezia peer ${client} on ${server.code} re-enabled`, {
      previousReason: peer.disabledReason,
    });
    return enabled;
  }

  private filterOwnXuiLinks(server: XuiServerConfig, links: string[]): string[] {
    const expectedHosts = new Set([
      new URL(server.subBaseUrl).hostname,
      new URL(server.apiBaseUrl).hostname,
    ]);

    return links.filter((link) => {
      try {
        return expectedHosts.has(new URL(link).hostname);
      } catch {
        return false;
      }
    });
  }
}

export const vpnService = new VpnService();
