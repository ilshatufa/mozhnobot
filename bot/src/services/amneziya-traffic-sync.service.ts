import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { amneziyaClient } from "./amneziya-client.js";

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

      for (const key of keys) {
        if (!key.server || !key.providerClientId) continue;

        try {
          const peer = await amneziyaClient.getPeerByClient(key.server, key.providerClientId);
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
    } finally {
      this.running = false;
    }
  }
}

export const amneziyaTrafficSyncService = new AmneziyaTrafficSyncService();
