import type { User, VpnKey } from "@prisma/client";
import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { xuiClient } from "./xui-client.js";

export interface VpnKeyResult {
  key: VpnKey;
  alreadyExisted: boolean;
}

export class VpnService {
  async getOrCreateKey(user: User): Promise<VpnKeyResult> {
    const existing = await vpnKeyRepository.findActiveByUserId(user.id);
    const xuiEmail = xuiClient.buildClientEmail(user.telegramId, user.username);

    if (existing) {
      let subId = existing.subId ?? "";

      // Backfill legacy keys without random subId by rotating to a new random one.
      if (!subId) {
        subId = xuiClient.generateSubId();
        await xuiClient.updateClientSubscription(
          existing.xuiClientId,
          xuiEmail,
          subId
        );
      }

      // Keep XUI client email aligned with current username format.
      await xuiClient.updateClientSubscription(
        existing.xuiClientId,
        xuiEmail,
        subId
      );

      const actualSubscriptionUrl = await xuiClient.getSubscriptionUrl(subId);

      if (existing.subscriptionUrl !== actualSubscriptionUrl || existing.subId !== subId) {
        const updated = await vpnKeyRepository.updateSubscription(existing.id, subId, actualSubscriptionUrl);
        return { key: updated, alreadyExisted: true };
      }

      return { key: existing, alreadyExisted: true };
    }

    await vpnKeyRepository.deactivateAllForUser(user.id);

    const { clientId, subId } = await xuiClient.addClient(user.telegramId, user.username);
    const subscriptionUrl = await xuiClient.getSubscriptionUrl(subId);

    const key = await vpnKeyRepository.create({
      userId: user.id,
      xuiClientId: clientId,
      subId,
      subscriptionUrl,
    });

    logger.info(`Unlimited VPN key created for user ${user.telegramId}`);

    return { key, alreadyExisted: false };
  }

  async disableKeysForUser(user: User): Promise<void> {
    const activeKey = await vpnKeyRepository.findActiveByUserId(user.id);

    if (activeKey) {
      try {
        const xuiEmail = xuiClient.buildClientEmail(user.telegramId, user.username);
        await xuiClient.disableClient(activeKey.xuiClientId, xuiEmail);
      } catch (err) {
        logger.warn(`Failed to disable client in 3X-UI for user ${user.telegramId}:`, err);
      }
      await vpnKeyRepository.deactivateAllForUser(user.id);
    }
  }

  async getStatus(user: User): Promise<{ status: "active" | "none" | "blocked"; key?: VpnKey }> {
    if (user.vpnBlocked) {
      return { status: "blocked" };
    }

    const activeKey = await vpnKeyRepository.findActiveByUserId(user.id);
    if (activeKey) {
      return { status: "active", key: activeKey };
    }

    return { status: "none" };
  }
}

export const vpnService = new VpnService();
