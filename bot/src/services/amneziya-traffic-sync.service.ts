import type { User, VpnKey, VpnServer } from "@prisma/client";
import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { amneziyaClient } from "./amneziya-client.js";

const GLOBAL_TRAFFIC_LIMIT_REASON = "global_traffic_limit";

type ActiveAmneziyaKey = VpnKey & {
  server: VpnServer | null;
  user?: Pick<User, "vpnTrafficLimitBytes">;
};

export class AmneziyaTrafficSyncService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = 60_000): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.syncOnce();
    }, intervalMs);
    this.timer.unref();

    logger.info("Amnezia traffic sync started", { intervalMs });
    void this.syncOnce();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async syncOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const keys = await vpnKeyRepository.findActiveAmneziyaKeysForSync();
      const affectedUserIds = new Set<number>();

      for (const key of keys) {
        if (!key.server || !key.providerClientId) continue;

        try {
          const peer = await amneziyaClient.getPeerByClient(key.server, key.providerClientId);
          affectedUserIds.add(key.userId);

          await vpnKeyRepository.updateAmneziyaData(key.id, {
            providerPeerId: peer.peerId,
            trafficUsedBytes: BigInt(peer.trafficUsedBytes),
            disabledReason: peer.disabledReason,
            isActive: peer.enabled && !peer.deleted,
            lastSyncedAt: new Date(),
          });
        } catch (error) {
          logger.warn("Failed to sync Amnezia peer traffic", {
            keyId: key.id,
            serverCode: key.server.code,
            client: key.providerClientId,
            error,
          });
        }
      }

      for (const userId of affectedUserIds) {
        await this.enforceUserLimit(userId);
      }
    } finally {
      this.running = false;
    }
  }

  private async enforceUserLimit(userId: number): Promise<void> {
    const keys = await vpnKeyRepository.findActiveAmneziyaKeysByUserId(userId);
    if (keys.length === 0) return;

    const limit = keys[0].user.vpnTrafficLimitBytes;
    if (limit === null) return;

    const used = keys.reduce((sum, key) => sum + (key.trafficUsedBytes ?? 0n), 0n);
    if (used < limit) return;

    await this.disableKeys(keys);
    await vpnKeyRepository.deactivateActiveAmneziyaByUserId(userId, GLOBAL_TRAFFIC_LIMIT_REASON);

    logger.info("Amnezia global traffic limit reached", {
      userId,
      used: used.toString(),
      limit: limit.toString(),
    });
  }

  private async disableKeys(keys: ActiveAmneziyaKey[]): Promise<void> {
    await Promise.all(keys.map(async (key) => {
      if (!key.server || !key.providerClientId) return;

      try {
        await amneziyaClient.disablePeer(key.server, key.providerClientId, GLOBAL_TRAFFIC_LIMIT_REASON);
      } catch (error) {
        logger.warn("Failed to disable Amnezia peer after global traffic limit", {
          keyId: key.id,
          serverCode: key.server.code,
          client: key.providerClientId,
          error,
        });
      }
    }));
  }
}

export const amneziyaTrafficSyncService = new AmneziyaTrafficSyncService();
