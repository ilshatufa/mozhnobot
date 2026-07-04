import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { peerService } from "./peer.service.js";

export class SchedulerService {
  private trafficTimer: NodeJS.Timeout | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;
  private runningTraffic = false;
  private runningExpiration = false;

  start(logger: FastifyBaseLogger): void {
    const runTraffic = async () => {
      if (this.runningTraffic) return;
      this.runningTraffic = true;
      try {
        await peerService.sampleTraffic();
      } catch (error) {
        logger.error({ error }, "Traffic sampling failed");
      } finally {
        this.runningTraffic = false;
      }
    };

    const runExpiration = async () => {
      if (this.runningExpiration) return;
      this.runningExpiration = true;
      try {
        await peerService.disableExpiredPeers();
      } catch (error) {
        logger.error({ error }, "Expiration check failed");
      } finally {
        this.runningExpiration = false;
      }
    };

    void runTraffic();
    void runExpiration();

    this.trafficTimer = setInterval(runTraffic, config.amnezia.trafficPollIntervalMs);
    this.expirationTimer = setInterval(runExpiration, config.amnezia.expirationPollIntervalMs);
  }

  stop(): void {
    if (this.trafficTimer) clearInterval(this.trafficTimer);
    if (this.expirationTimer) clearInterval(this.expirationTimer);
    this.trafficTimer = null;
    this.expirationTimer = null;
  }
}

export const schedulerService = new SchedulerService();

