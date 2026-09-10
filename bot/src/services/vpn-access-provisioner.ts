import {
  VpnProvider,
  VpnSubscriptionInboundStatus,
  type VpnKey,
} from "@prisma/client";
import { config, type XuiServerConfig } from "../config.js";
import { prisma } from "../database.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import type { VpnSubscriptionForSync } from "../repositories/vpn-subscription.repository.js";
import { xuiClient } from "./xui-client.js";
import type { VpnAccessSyncPlan } from "./vpn-access-sync-plan.js";

export interface VpnAccessProvisioningResult {
  success: boolean;
  errors: string[];
}

export function vpnProductClientEmail(
  telegramId: bigint,
  username: string | null,
  productCode: string,
  clientGroup = "default",
): string {
  const base = xuiClient.buildClientEmail(telegramId, username);
  const product = productCode.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const group = clientGroup.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const suffix = group === "default" || group === "direct" ? product : `${product}__${group}`;
  return `${base}__${suffix}`.slice(0, 255);
}

export class VpnAccessProvisioner {
  async apply(
    subscription: VpnSubscriptionForSync,
    plan: VpnAccessSyncPlan,
  ): Promise<VpnAccessProvisioningResult> {
    const errors = plan.eligible
      ? await this.ensureEligibleSubscription(subscription)
      : await this.disableIneligibleSubscription(subscription);
    const now = new Date();

    await prisma.vpnSubscription.update({
      where: { id: subscription.id },
      data: errors.length === 0
        ? {
            appliedRevision: plan.targetRevision,
            lastSyncedAt: now,
            lastError: null,
          }
        : {
            lastSyncedAt: now,
            lastError: errors.join("\n"),
          },
    });

    return { success: errors.length === 0, errors };
  }

  private async ensureEligibleSubscription(subscription: VpnSubscriptionForSync): Promise<string[]> {
    const desiredInboundIds = new Set(
      subscription.product.inbounds
        .filter((item) => item.inbound.isActive)
        .map((item) => item.inboundId),
    );
    const serverIds = new Set<number>();
    for (const item of subscription.product.inbounds) {
      if (item.inbound.isActive) serverIds.add(item.inbound.serverId);
    }
    for (const state of subscription.inboundStates) {
      if (!desiredInboundIds.has(state.inboundId)) serverIds.add(state.inbound.serverId);
    }

    const keysByServerId = new Map<number, VpnKey[]>();
    for (const key of subscription.keys) {
      if (key.serverId === null) continue;
      const current = keysByServerId.get(key.serverId) ?? [];
      current.push(key);
      keysByServerId.set(key.serverId, current);
    }
    const errors: string[] = [];

    for (const serverId of serverIds) {
      const desired = subscription.product.inbounds.filter(
        (item) => item.inbound.isActive && item.inbound.serverId === serverId,
      );
      const stale = subscription.inboundStates.filter(
        (state) => state.inbound.serverId === serverId && !desiredInboundIds.has(state.inboundId),
      );
      try {
        const server = desired[0]?.inbound.server ?? stale[0]?.inbound.server;
        if (!server) throw new Error(`VPN server ${serverId} is missing from the subscription plan`);
        const serverConfig = this.requireServerConfig(server.code);
        const serverKeys = keysByServerId.get(serverId) ?? [];
        const desiredByGroup = new Map<string, typeof desired>();
        for (const item of desired) {
          const current = desiredByGroup.get(item.clientGroup) ?? [];
          current.push(item);
          desiredByGroup.set(item.clientGroup, current);
        }

        if (!desiredByGroup.has("default")) {
          const legacyKeys = serverKeys.filter((key) => key.clientGroup === "default");
          if (
            legacyKeys.length === 1 &&
            desiredByGroup.has("direct") &&
            !serverKeys.some((key) => key.clientGroup === "direct")
          ) {
            const adopted = await vpnKeyRepository.updateClientGroup(legacyKeys[0].id, "direct");
            serverKeys.splice(serverKeys.indexOf(legacyKeys[0]), 1, adopted);
          }
        }

        const ensuredKeys = new Map<string, VpnKey>();
        for (const [clientGroup, groupInbounds] of desiredByGroup) {
          const existingKey = serverKeys.find((key) => key.clientGroup === clientGroup) ?? null;
          const ensuredKey = await this.ensureServerClient(
            subscription,
            serverConfig,
            serverId,
            clientGroup,
            groupInbounds,
            existingKey,
          );
          ensuredKeys.set(clientGroup, ensuredKey);
          if (!serverKeys.some((key) => key.id === ensuredKey.id)) serverKeys.push(ensuredKey);
        }

        const keysById = new Map(serverKeys.map((key) => [key.id, key]));
        for (const state of stale) {
          const candidateKeys = state.keyId === null
            ? serverKeys
            : [keysById.get(state.keyId)].filter((key): key is VpnKey => key !== undefined);
          for (const key of candidateKeys) {
            if (!key.providerClientId) continue;
            const attachedProviderIds = await xuiClient.getClientInboundIds(
              serverConfig,
              key.providerClientId,
            );
            if (!attachedProviderIds.includes(state.inbound.providerInboundId)) continue;
            await xuiClient.detachClientFromInbounds(
              serverConfig,
              key.providerClientId,
              [state.inbound.providerInboundId],
            );
          }
        }

        for (const key of serverKeys) {
          if (desiredByGroup.has(key.clientGroup) || !key.providerClientId) continue;
          await xuiClient.setClientEnabled(serverConfig, key.providerClientId, false);
          await vpnKeyRepository.setActive(key.id, false);
        }

        for (const [clientGroup, groupInbounds] of desiredByGroup) {
          const ensuredKey = ensuredKeys.get(clientGroup);
          if (!ensuredKey) throw new Error(`VPN client group ${clientGroup} was not provisioned`);
          await this.markStates(subscription.id, groupInbounds.map((item) => item.inboundId), {
            status: VpnSubscriptionInboundStatus.ACTIVE,
            keyId: ensuredKey.id,
            lastAttemptAt: new Date(),
            lastSyncedAt: new Date(),
            lastError: null,
          });
        }
        await this.markStates(subscription.id, stale.map((state) => state.inboundId), {
          status: VpnSubscriptionInboundStatus.DISABLED,
          lastSyncedAt: new Date(),
          lastError: null,
        });
      } catch (err) {
        const message = this.errorMessage(err);
        errors.push(message);
      }
    }

    return errors;
  }

  private async ensureServerClient(
    subscription: VpnSubscriptionForSync,
    serverConfig: XuiServerConfig,
    serverId: number,
    clientGroup: string,
    desired: VpnSubscriptionForSync["product"]["inbounds"],
    existingKey: VpnKey | null,
  ): Promise<VpnKey> {
    const desiredProviderIds = desired.map((item) => item.inbound.providerInboundId);
    const trafficLimits = new Set(desired.map((item) => item.trafficLimitBytes?.toString() ?? "unlimited"));
    const trafficResetDays = new Set(desired.map((item) => item.trafficResetDays));
    if (trafficLimits.size !== 1 || trafficResetDays.size !== 1) {
      throw new Error(
        `VPN client group ${clientGroup} on ${serverConfig.code} has inconsistent traffic policy`,
      );
    }
    const trafficLimitBytes = desired[0]?.trafficLimitBytes ?? null;
    const resetDays = desired[0]?.trafficResetDays ?? 0;
    const expiryTime = subscription.expiresAt?.getTime() ?? 0;
    let key = existingKey;

    if (!key) {
      const email = vpnProductClientEmail(
        subscription.user.telegramId,
        subscription.user.username,
        subscription.product.code,
        clientGroup,
      );
      const created = await xuiClient.addClient(
        serverConfig,
        subscription.user.telegramId,
        subscription.user.username,
        expiryTime,
        trafficLimitBytes,
        { email, inboundIds: desiredProviderIds, trafficResetDays: resetDays },
      );
      key = await vpnKeyRepository.create({
        userId: subscription.userId,
        serverId,
        subscriptionId: subscription.id,
        clientGroup,
        provider: VpnProvider.XUI,
        xuiClientId: created.clientId,
        providerClientId: created.email,
        providerPeerId: created.clientId,
        subId: created.subId,
        subscriptionUrl: xuiClient.getSubscriptionUrl(serverConfig, created.subId),
        expiresAt: subscription.expiresAt,
      });
      return key;
    }

    if (!key.providerClientId) {
      throw new Error(`VPN key ${key.id} has no provider client email`);
    }

    const attachedProviderIds = await xuiClient.getClientInboundIds(serverConfig, key.providerClientId);
    const missingProviderIds = desiredProviderIds.filter((id) => !attachedProviderIds.includes(id));
    await xuiClient.attachClientToInbounds(serverConfig, key.providerClientId, missingProviderIds);
    if (!key.subId) throw new Error(`VPN key ${key.id} has no subscription ID`);
    await xuiClient.updateClientSubscription(
      serverConfig,
      key.xuiClientId,
      key.providerClientId,
      key.providerClientId,
      expiryTime,
      key.subId,
      trafficLimitBytes,
      resetDays,
    );
    await vpnKeyRepository.setActive(key.id, true);
    return key;
  }

  private async disableIneligibleSubscription(subscription: VpnSubscriptionForSync): Promise<string[]> {
    const errors: string[] = [];
    const inboundIds = subscription.inboundStates.map((state) => state.inboundId);

    await this.markStates(subscription.id, inboundIds, {
      status: VpnSubscriptionInboundStatus.PROVISIONING,
      lastAttemptAt: new Date(),
      lastError: null,
    });

    for (const key of subscription.keys) {
      if (!key.server || !key.providerClientId) {
        errors.push(`VPN key ${key.id} is missing server or provider client email`);
        continue;
      }

      try {
        await xuiClient.setClientEnabled(
          this.requireServerConfig(key.server.code),
          key.providerClientId,
          false,
        );
        await vpnKeyRepository.setActive(key.id, false);
      } catch (err) {
        const message = this.errorMessage(err);
        errors.push(message);
      }
    }

    await this.markStates(subscription.id, inboundIds, errors.length === 0
      ? {
          status: VpnSubscriptionInboundStatus.DISABLED,
          lastSyncedAt: new Date(),
          lastError: null,
        }
      : {
          status: VpnSubscriptionInboundStatus.ERROR,
          lastSyncedAt: new Date(),
          lastError: errors.join("\n"),
        });

    return errors;
  }

  private async markStates(
    subscriptionId: number,
    inboundIds: number[],
    data: {
      status: VpnSubscriptionInboundStatus;
      keyId?: number;
      lastAttemptAt?: Date;
      lastSyncedAt?: Date;
      lastError: string | null;
    },
  ): Promise<void> {
    if (inboundIds.length === 0) return;
    await prisma.$transaction(
      [...new Set(inboundIds)].map((inboundId) => prisma.vpnSubscriptionInboundState.upsert({
        where: { subscriptionId_inboundId: { subscriptionId, inboundId } },
        create: { subscriptionId, inboundId, ...data },
        update: data,
      })),
    );
  }

  private requireServerConfig(code: string): XuiServerConfig {
    const server = config.vpnServers.xui.servers.find((candidate) => candidate.code === code);
    if (!server) throw new Error(`3X-UI server ${code} is not configured`);
    if (server.clientApiMode !== "clients") {
      throw new Error(`3X-UI server ${code} does not support product inbound synchronization`);
    }
    return server;
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

export const vpnAccessProvisioner = new VpnAccessProvisioner();
