import { VpnProvider, type User, type VpnKey, type VpnServer } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { vpnServerRepository } from "../repositories/vpn-server.repository.js";
import { amneziyaClient } from "./amneziya-client.js";
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

function expiresAtFromNow(user: User): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + user.vpnDurationDays);
  return expiresAt;
}

function trafficLimitBytes(user: User): bigint | null {
  return user.vpnTrafficLimitBytes;
}

export class VpnService {
  async getOrCreateKey(user: User): Promise<VpnKeyResult> {
    return this.getOrCreateXuiKey(user);
  }

  async listAmneziyaServers(): Promise<VpnServer[]> {
    return vpnServerRepository.findActiveManyByProvider(VpnProvider.AMNEZIA);
  }

  async getOrCreateXuiKey(user: User): Promise<VpnKeyResult> {
    const server = await this.requireServer(config.vpnServers.xui.code, VpnProvider.XUI);
    const existingForServer = await vpnKeyRepository.findActiveByUserAndServer(user.id, server.id);
    const existingLegacy = existingForServer ? null : await vpnKeyRepository.findActiveLegacyXuiByUser(user.id);
    const existing = existingForServer ?? existingLegacy;
    const xuiEmail = xuiClient.buildClientEmail(user.telegramId, user.username);

    if (existing) {
      const attached = existing.serverId === server.id
        ? existing
        : await vpnKeyRepository.attachServer(existing.id, { serverId: server.id, provider: VpnProvider.XUI });
      let subId = existing.subId ?? "";

      // Backfill legacy keys without random subId by rotating to a new random one.
      if (!subId) {
        subId = xuiClient.generateSubId();
        await xuiClient.updateClientSubscription(
          existing.xuiClientId,
          xuiEmail,
          existing.expiresAt.getTime(),
          subId,
          trafficLimitBytes(user)
        );
      }

      // Keep XUI client email aligned with current username format.
      await xuiClient.updateClientSubscription(
        existing.xuiClientId,
        xuiEmail,
        existing.expiresAt.getTime(),
        subId,
        trafficLimitBytes(user)
      );

      const actualSubscriptionUrl = await xuiClient.getSubscriptionUrl(subId);

      if (existing.subscriptionUrl !== actualSubscriptionUrl || existing.subId !== subId) {
        const updated = await vpnKeyRepository.updateSubscription(attached.id, subId, actualSubscriptionUrl);
        return { key: updated, alreadyExisted: true };
      }

      return { key: attached, alreadyExisted: true };
    }

    const expiresAt = expiresAtFromNow(user);
    const expiryTime = expiresAt.getTime();
    const limitBytes = trafficLimitBytes(user);

    const { clientId, subId } = await xuiClient.addClient(user.telegramId, user.username, expiryTime, limitBytes);
    const subscriptionUrl = await xuiClient.getSubscriptionUrl(subId);

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

  async getOrCreateAmneziyaKey(user: User, serverCode = config.vpnServers.amneziya.code): Promise<AmneziyaKeyResult> {
    const server = await this.requireServer(serverCode, VpnProvider.AMNEZIA);
    const existing = await vpnKeyRepository.findActiveByUserAndServer(user.id, server.id);
    const client = amneziyaClient.buildClientId(user.telegramId);

    if (existing) {
      if (existing.configText && existing.qrPngBase64) {
        return {
          key: existing,
          alreadyExisted: true,
          configText: existing.configText,
          qrPngBase64: existing.qrPngBase64,
          configFileName: amneziyaClient.buildConfigFileName(server.code),
        };
      }

      const [configText, qrPngBase64, peer] = await Promise.all([
        amneziyaClient.getConfig(server, client),
        amneziyaClient.getQrPngBase64(server, client),
        amneziyaClient.getPeerByClient(server, client),
      ]);
      const updated = await vpnKeyRepository.updateAmneziyaData(existing.id, {
        providerClientId: client,
        providerPeerId: peer.peerId,
        configText,
        qrPngBase64,
        trafficLimitBytes: trafficLimitBytes(user),
        trafficUsedBytes: BigInt(peer.trafficUsedBytes),
        disabledReason: peer.disabledReason,
        isActive: peer.enabled && !peer.deleted,
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
    const limitBytes = trafficLimitBytes(user);
    const peer = await amneziyaClient.createPeer(server, {
      client,
      expiresAt,
      trafficLimitBytes: null,
    });
    const [configText, qrPngBase64] = await Promise.all([
      peer.config ? Promise.resolve(peer.config) : amneziyaClient.getConfig(server, client),
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
      expiresAt,
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

  async disableKeysForUser(user: User): Promise<void> {
    const activeKeys = await vpnKeyRepository.findActiveManyByUserId(user.id);

    for (const activeKey of activeKeys) {
      try {
        if (activeKey.provider === VpnProvider.AMNEZIA && activeKey.providerClientId) {
          await amneziyaClient.disablePeer(activeKey.server, activeKey.providerClientId, "blocked");
        } else {
          const xuiEmail = activeKey.providerClientId ?? xuiClient.buildClientEmail(user.telegramId, user.username);
          await xuiClient.disableClient(activeKey.xuiClientId, xuiEmail);
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
}

export const vpnService = new VpnService();
