import { VpnTrialStatus } from "@prisma/client";
import { Markup, type Telegram } from "telegraf";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { formatPaidVpnDate } from "../paid-vpn-copy.js";
import { vpnAccessSyncService } from "./vpn-access-sync.service.js";

const ENDING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export class VpnTrialNotificationService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(telegram: Telegram): void {
    if (this.timer) return;
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.processDue(telegram);
      } catch (error) {
        logger.error("Paid VPN trial notification pass failed", error);
      } finally {
        this.running = false;
      }
    };
    void run();
    this.timer = setInterval(() => void run(), config.vpnBot.trial.notificationIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processDue(telegram: Telegram, now = new Date()): Promise<void> {
    const soon = await prisma.vpnTrial.findMany({
      where: {
        status: VpnTrialStatus.ACTIVE,
        endsAt: { gt: now, lte: new Date(now.getTime() + ENDING_SOON_WINDOW_MS) },
        endingSoonNotifiedAt: null,
      },
      include: { vpnSubscription: { include: { user: true } } },
      orderBy: { endsAt: "asc" },
      take: 100,
    });
    for (const trial of soon) {
      const claimed = await prisma.vpnTrial.updateMany({
        where: { id: trial.id, endingSoonNotifiedAt: null, status: VpnTrialStatus.ACTIVE },
        data: { endingSoonNotifiedAt: now },
      });
      if (claimed.count !== 1 || !trial.endsAt) continue;
      try {
        await telegram.sendMessage(
          trial.vpnSubscription.user.telegramId.toString(),
          `Пробный период МОЖНО VPN закончится ${formatPaidVpnDate(trial.endsAt)}. Списаний не будет. Можно оплатить 30 дней сейчас или продолжить до конца пробного срока.`,
          Markup.inlineKeyboard([[Markup.button.callback("Открыть VPN", "vpn_status")]]),
        );
      } catch (error) {
        await prisma.vpnTrial.update({
          where: { id: trial.id },
          data: { endingSoonNotifiedAt: null },
        });
        throw error;
      }
    }

    const expired = await prisma.vpnTrial.findMany({
      where: {
        status: { in: [VpnTrialStatus.ACTIVE, VpnTrialStatus.EXPIRED] },
        endsAt: { lte: now },
        expiredNotifiedAt: null,
      },
      include: { vpnSubscription: { include: { user: true } } },
      orderBy: { endsAt: "asc" },
      take: 100,
    });
    for (const trial of expired) {
      const claimed = await prisma.vpnTrial.updateMany({
        where: {
          id: trial.id,
          expiredNotifiedAt: null,
          status: { in: [VpnTrialStatus.ACTIVE, VpnTrialStatus.EXPIRED] },
          endsAt: { lte: now },
        },
        data: { status: VpnTrialStatus.EXPIRED, expiredNotifiedAt: now },
      });
      if (claimed.count !== 1) continue;
      try {
        const [sync] = await vpnAccessSyncService.sync({
          subscriptionId: trial.vpnSubscriptionId,
          now,
        });
        if (!sync?.provisioning?.success) {
          throw new Error(sync?.provisioning?.errors.join("; ") || "VPN trial expiry sync failed");
        }
        await telegram.sendMessage(
          trial.vpnSubscription.user.telegramId.toString(),
          "Пробный период МОЖНО VPN закончился. Списаний не было. Личная ссылка и профили сохранены — оплатить 30 дней можно в боте.",
          Markup.inlineKeyboard([[Markup.button.callback("Открыть VPN", "vpn_status")]]),
        );
      } catch (error) {
        await prisma.vpnTrial.update({
          where: { id: trial.id },
          data: { expiredNotifiedAt: null },
        });
        throw error;
      }
    }
  }
}

export const vpnTrialNotificationService = new VpnTrialNotificationService();
