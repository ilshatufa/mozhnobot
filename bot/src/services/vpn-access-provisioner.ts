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
): string {
  const base = xuiClient.buildClientEmail(telegramId, username);
  const product = productCode.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `${base}__${product}`.slice(0, 255);
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

    const keysByServerId = new Map(
      subscription.keys
        .filter((key): key is typeof key & { serverId: number } => key.serverId !== null)
        .map((key) => [key.serverId, key]),
    );
    const errors: string[] = [];

    for (const serverId of serverIds) {
      const desired = subscription.product.inbounds.filter(
        (item) => item.inbound.isActive && item.inbound.serverId === serverId,
      );
      const stale = subscription.inboundStates.filter(
        (state) => state.inbound.serverId === serverId && !desiredInboundIds.has(state.inboundId),
      );
      const affectedInboundIds = [...new Set([
        ...desired.map((item) => item.inboundId),
        ...stale.map((state) => state.inboundId),
      ])];

      await this.markStates(subscription.id, desired.map((item) => item.inboundId), {
        status: VpnSubscriptionInboundStatus.PROVISIONING,
        lastAttemptAt: new Date(),
        lastError: null,
      });

      try {
        const server = desired[0]?.inbound.server ?? stale[0]?.inbound.server;
        if (!server) throw new Error(`VPN server ${serverId} is missing from the subscription plan`);
        const serverConfig = this.requireServerConfig(server.code);
        let key = keysByServerId.get(serverId) ?? null;

        if (desired.length > 0) {
          const ensuredKey = await this.ensureServerClient(
            subscription,
            serverConfig,
            serverId,
            desired,
            stale,
            key,
          );
          await this.markStates(subscription.id, desired.map((item) => item.inboundId), {
            status: VpnSubscriptionInboundStatus.ACTIVE,
            keyId: ensuredKey.id,
            lastSyncedAt: new Date(),
            lastError: null,
          });
        } else if (key?.providerClientId) {
          const staleProviderIds = stale.map((state) => state.inbound.providerInboundId);
          await xuiClient.detachClientFromInbounds(serverConfig, key.providerClientId, staleProviderIds);
          await xuiClient.setClientEnabled(serverConfig, key.providerClientId, false);
          await vpnKeyRepository.setActive(key.id, false);
        }

        await this.markStates(subscription.id, stale.map((state) => state.inboundId), {
          status: VpnSubscriptionInboundStatus.DISABLED,
          lastSyncedAt: new Date(),
          lastError: null,
        });
      } catch (err) {
        const message = this.errorMessage(err);
        errors.push(message);
        await this.markStates(subscription.id, affectedInboundIds, {
          status: VpnSubscriptionInboundStatus.ERROR,
          lastSyncedAt: new Date(),
          lastError: message,
        });
      }
    }

    return errors;
  }

  private async ensureServerClient(
    subscription: VpnSubscriptionForSync,
    serverConfig: XuiServerConfig,
    serverId: number,
    desired: VpnSubscriptionForSync["product"]["inbounds"],
    stale: VpnSubscriptionForSync["inboundStates"],
    existingKey: VpnKey | null,
  ): Promise<VpnKey> {
    const desiredProviderIds = desired.map((item) => item.inbound.providerInboundId);
    let key = existingKey;

    if (!key) {
      const email = vpnProductClientEmail(
        subscription.user.telegramId,
        subscription.user.username,
        subscription.product.code,
      );
      const created = await xuiClient.addClient(
        serverConfig,
        subscription.user.telegramId,
        subscription.user.username,
        0,
        null,
        { email, inboundIds: desiredProviderIds },
      );
      key = await vpnKeyRepository.create({
        userId: subscription.userId,
        serverId,
        subscriptionId: subscription.id,
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
    const staleProviderIds = stale
      .map((state) => state.inbound.providerInboundId)
      .filter((id) => attachedProviderIds.includes(id));
    await xuiClient.attachClientToInbounds(serverConfig, key.providerClientId, missingProviderIds);
    await xuiClient.detachClientFromInbounds(serverConfig, key.providerClientId, staleProviderIds);
    await xuiClient.setClientEnabled(serverConfig, key.providerClientId, true);
    await vpnKeyRepository.setActive(key.id, true);
    return key;
  }

  private async disableIneligibleSubscription(subscription: VpnSubscriptionForSync): Promise<string[]> {
    const errors: string[] = [];
    const statesByServerId = new Map<number, number[]>();
    for (const state of subscription.inboundStates) {
      const current = statesByServerId.get(state.inbound.serverId) ?? [];
      current.push(state.inboundId);
      statesByServerId.set(state.inbound.serverId, current);
    }

    for (const key of subscription.keys) {
      if (!key.server || !key.providerClientId) {
        errors.push(`VPN key ${key.id} is missing server or provider client email`);
        continue;
      }

      const inboundIds = statesByServerId.get(key.server.id) ?? [];
      await this.markStates(subscription.id, inboundIds, {
        status: VpnSubscriptionInboundStatus.PROVISIONING,
        lastAttemptAt: new Date(),
        lastError: null,
      });

      try {
        await xuiClient.setClientEnabled(
          this.requireServerConfig(key.server.code),
          key.providerClientId,
          false,
        );
        await vpnKeyRepository.setActive(key.id, false);
        await this.markStates(subscription.id, inboundIds, {
          status: VpnSubscriptionInboundStatus.DISABLED,
          lastSyncedAt: new Date(),
          lastError: null,
        });
      } catch (err) {
        const message = this.errorMessage(err);
        errors.push(message);
        await this.markStates(subscription.id, inboundIds, {
          status: VpnSubscriptionInboundStatus.ERROR,
          lastSyncedAt: new Date(),
          lastError: message,
        });
      }
    }

    if (subscription.keys.length === 0) {
      await this.markStates(
        subscription.id,
        subscription.inboundStates.map((state) => state.inboundId),
        {
          status: VpnSubscriptionInboundStatus.DISABLED,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      );
    }

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
