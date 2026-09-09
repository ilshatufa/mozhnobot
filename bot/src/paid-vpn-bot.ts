import { Telegraf } from "telegraf";
import { config } from "./config.js";
import {
  paidVpnAccessHandler,
  paidVpnAddHandler,
  paidVpnStartHandler,
} from "./handlers/paid-vpn.js";
import {
  type PaidVpnContext,
  paidVpnAdminOnly,
  paidVpnAuthMiddleware,
} from "./middlewares/paid-vpn-auth.js";
import { logger } from "./logger.js";
import { isBotBlockedError } from "./telegram-errors.js";

export function createPaidVpnBot(): Telegraf<PaidVpnContext> {
  if (!config.vpnBot.token) throw new Error("VPN_BOT_TOKEN is required");

  const bot = new Telegraf<PaidVpnContext>(config.vpnBot.token);
  bot.catch((error, ctx) => {
    if (isBotBlockedError(error)) {
      logger.info("User blocked paid VPN bot", { fromId: ctx.from?.id ?? null });
      return;
    }
    logger.error("Paid VPN bot update failed", {
      updateType: ctx.updateType,
      updateId: ctx.update.update_id,
      fromId: ctx.from?.id ?? null,
      error,
    });
  });
  bot.use(paidVpnAuthMiddleware());
  bot.command("start", paidVpnStartHandler);
  bot.command("vpn", paidVpnAccessHandler);
  bot.command("add", paidVpnAdminOnly(), paidVpnAddHandler);
  return bot;
}
