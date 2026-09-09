import { VpnProvider, type User, type VpnKey, type VpnServer } from "@prisma/client";
import { config, type XuiServerConfig } from "../config.js";
import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { vpnServerRepository } from "../repositories/vpn-server.repository.js";
import { vpnSubscriptionRepository } from "../repositories/vpn-subscription.repository.js";
import { vpnAccessSyncService } from "./vpn-access-sync.service.js";
import { xuiClient } from "./xui-client.js";

export interface VpnKeyResult {
  key: VpnKey;
  alreadyExisted: boolean;
}

function isXuiRecordNotFoundError(err: unknown): boolean {
  return err instanceof Error && /record not found|not found/i.test(err.message);
}

export class VpnService {
  async getOrCreateKey(user: User): Promise<VpnKeyResult> {
    const { subscription, alreadyExisted } = await vpnSubscriptionRepository.findOrCreateForProduct(
      user.id,
      "club",
      xuiClient.generateSubId(),
    );
    const [syncResult] = await vpnAccessSyncService.sync({ subscriptionId: subscription.id });
    if (!syncResult) throw new Error(`VPN subscription ${subscription.id} was not found during synchronization`);
    if (!syncResult.plan.eligible) {
      throw new Error(`VPN access is not allowed: ${syncResult.plan.reason}`);
    }
    if (!syncResult.provisioning?.success) {
      throw new Error(
        `VPN subscription synchronization failed: ${syncResult.provisioning?.errors.join("; ") ?? "unknown error"}`,
      );
    }

    const [fresh] = await vpnSubscriptionRepository.findManyForSync({
      subscriptionId: subscription.id,
    });
    const aggregatorCode = config.vpnServers.xui.multiServerCode;
    const key = fresh?.keys.find(
      (candidate) => candidate.isActive && candidate.server?.code === aggregatorCode,
    ) ?? fresh?.keys.find((candidate) => candidate.isActive);
    if (!key) throw new Error(`VPN subscription ${subscription.id} has no active key`);

    const baseUrl = config.vpnServers.xui.multiSubBaseUrl;
    if (!baseUrl) throw new Error("VPN public subscription base URL is not configured");
    return {
      key: {
        ...key,
        subscriptionUrl: `${baseUrl.replace(/\/+$/, "")}/sub/${subscription.token}`,
      },
      alreadyExisted,
    };
  }

  async listXuiServers(): Promise<VpnServer[]> {
    return vpnServerRepository.findActiveMany();
  }

  async getOrCreateXuiKey(user: User, serverCode = config.vpnServers.xui.code): Promise<VpnKeyResult> {
    const serverConfig = this.requireXuiServerConfig(serverCode);
    const server = await this.requireServer(serverConfig.code);
    const existingForServer = await vpnKeyRepository.findActiveByUserAndServer(user.id, server.id);
    const existingLegacy = existingForServer || serverConfig.code !== config.vpnServers.xui.code
      ? null
      : await vpnKeyRepository.findActiveLegacyXuiByUser(user.id);
    const existing = existingForServer ?? existingLegacy;
    const email = xuiClient.buildClientEmail(user.telegramId, user.username);

    if (existing) {
      const attached = existing.serverId === server.id
        ? existing
        : await vpnKeyRepository.attachServer(existing.id, server.id);
      let subId = existing.subId || xuiClient.generateSubId();
      let clientId = existing.xuiClientId;
      let peerId = existing.providerPeerId ?? existing.xuiClientId;

      try {
        await xuiClient.updateClientSubscription(
          serverConfig,
          clientId,
          existing.providerClientId ?? email,
          email,
          0,
          subId,
          null
        );
      } catch (err) {
        if (!isXuiRecordNotFoundError(err)) throw err;
        const created = await xuiClient.addClient(serverConfig, user.telegramId, user.username, 0, null);
        clientId = created.clientId;
        peerId = created.clientId;
        subId = created.subId;
        logger.warn(`3X-UI ${serverConfig.code} missing client was recreated`, {
          oldClientId: existing.xuiClientId,
          newClientId: clientId,
        });
      }

      const directUrl = xuiClient.getSubscriptionUrl(serverConfig, subId);
      if (
        attached.xuiClientId !== clientId ||
        attached.subscriptionUrl !== directUrl ||
        attached.subId !== subId ||
        attached.providerClientId !== email ||
        attached.providerPeerId !== peerId ||
        attached.expiresAt !== null
      ) {
        const updated = await vpnKeyRepository.updateXuiSubscription(attached.id, {
          xuiClientId: clientId,
          providerClientId: email,
          providerPeerId: peerId,
          subId,
          subscriptionUrl: directUrl,
          expiresAt: null,
        });
        return { key: updated, alreadyExisted: true };
      }

      return { key: attached, alreadyExisted: true };
    }

    const created = await xuiClient.addClient(serverConfig, user.telegramId, user.username, 0, null);
    const key = await vpnKeyRepository.create({
      userId: user.id,
      serverId: server.id,
      provider: VpnProvider.XUI,
      xuiClientId: created.clientId,
      providerClientId: created.email,
      providerPeerId: created.clientId,
      subId: created.subId,
      subscriptionUrl: xuiClient.getSubscriptionUrl(serverConfig, created.subId),
      expiresAt: null,
    });

    logger.info("Unlimited Xray key created", { userId: user.id, server: server.code });
    return { key, alreadyExisted: false };
  }

  async getOrCreateMultiXuiKey(user: User): Promise<VpnKeyResult> {
    const activeServers = await this.listXuiServers();
    const activeConfigs = activeServers
      .map((server) => config.vpnServers.xui.servers.find((item) => item.code === server.code))
      .filter((server): server is XuiServerConfig => Boolean(server));

    if (activeConfigs.length === 0) throw new Error("No active 3X-UI servers are configured");

    const aggregator = config.vpnServers.xui.multiServerCode
      ? activeConfigs.find((server) => server.code === config.vpnServers.xui.multiServerCode)
      : activeConfigs.find((server) => server.clientApiMode === "clients");
    if (!aggregator || aggregator.clientApiMode !== "clients") {
      throw new Error("No 3X-UI server with clients API is configured as subscription entry point");
    }

    const results: Array<{ server: XuiServerConfig; result: VpnKeyResult }> = [];
    for (const server of activeConfigs) {
      results.push({ server, result: await this.getOrCreateXuiKey(user, server.code) });
    }

    const aggregatorItem = results.find((item) => item.server.code === aggregator.code);
    if (!aggregatorItem) throw new Error(`3X-UI aggregator ${aggregator.code} key was not created`);

    const externalLinks: string[] = [];
    for (const item of results) {
      if (item.server.code === aggregator.code) continue;
      const links = await xuiClient.fetchSubscriptionLinks(item.result.key.subscriptionUrl);
      externalLinks.push(...this.filterOwnXuiLinks(item.server, links));
    }
    const aggregatorEmail = aggregatorItem.result.key.providerClientId ??
      xuiClient.buildClientEmail(user.telegramId, user.username);
    await xuiClient.updateExternalLinks(aggregator, aggregatorEmail, externalLinks);

    let publicKey = aggregatorItem.result.key;
    if (config.vpnServers.xui.multiSubBaseUrl && publicKey.subId) {
      const publicUrl = `${config.vpnServers.xui.multiSubBaseUrl.replace(/\/+$/, "")}/sub/${publicKey.subId}`;
      if (publicKey.subscriptionUrl !== publicUrl) {
        publicKey = await vpnKeyRepository.updateXuiSubscription(publicKey.id, {
          xuiClientId: publicKey.xuiClientId,
          providerClientId: publicKey.providerClientId ?? aggregatorEmail,
          providerPeerId: publicKey.providerPeerId,
          subId: publicKey.subId,
          subscriptionUrl: publicUrl,
          expiresAt: null,
        });
      }
    }

    logger.info("Multi-server Xray subscription updated", {
      userId: user.id,
      aggregator: aggregator.code,
      servers: activeConfigs.map((server) => server.code),
      links: externalLinks.length + 1,
    });
    return {
      key: publicKey,
      alreadyExisted: results.every((item) => item.result.alreadyExisted),
    };
  }

  async disableKeysForUser(user: User): Promise<void> {
    const activeKeys = await vpnKeyRepository.findActiveManyByUserId(user.id);
    for (const key of activeKeys) {
      try {
        const server = this.requireXuiServerConfig(key.server?.code ?? config.vpnServers.xui.code);
        const email = key.providerClientId ?? xuiClient.buildClientEmail(user.telegramId, user.username);
        await xuiClient.disableClient(server, key.xuiClientId, email);
      } catch (err) {
        logger.warn(`Failed to disable Xray key ${key.id}`, err);
      }
    }
    await vpnKeyRepository.deactivateAllForUser(user.id);
  }

  async getStatus(user: User): Promise<{ status: "active" | "none" | "blocked"; key?: VpnKey }> {
    if (user.vpnBlocked) return { status: "blocked" };
    const key = await vpnKeyRepository.findActiveByUserId(user.id);
    return key ? { status: "active", key } : { status: "none" };
  }

  private async requireServer(code: string): Promise<VpnServer> {
    const server = await vpnServerRepository.findActiveByCode(code);
    if (!server || server.provider !== VpnProvider.XUI) throw new Error(`Xray server ${code} is not configured`);
    return server;
  }

  private requireXuiServerConfig(code: string): XuiServerConfig {
    const server = config.vpnServers.xui.servers.find((item) => item.code === code);
    if (!server) throw new Error(`3X-UI server ${code} is not configured`);
    return server;
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
