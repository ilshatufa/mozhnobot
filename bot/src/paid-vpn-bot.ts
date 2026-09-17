import { Telegraf } from "telegraf";
import { config } from "./config.js";
import {
  paidVpnAccessHandler,
  paidVpnAddHandler,
  paidVpnRemoveHandler,
  paidVpnStartHandler,
} from "./handlers/paid-vpn.js";
import {
  extractBotSubscriptionUpdate,
  paidVpnBuyConfirmHandler,
  paidVpnBuyHandler,
  paidVpnCancelConfirmHandler,
  paidVpnCancelHandler,
  paidVpnPreCheckoutHandler,
  paidVpnStarsHelpHandler,
  paidVpnSubscriptionUpdatedHandler,
  paidVpnSuccessfulPaymentHandler,
  paidVpnSupportHandler,
  paidVpnTermsHandler,
  paidVpnTrialStartHandler,
} from "./handlers/paid-vpn-payments.js";
import { showPaidVpnScreen } from "./handlers/paid-vpn-screen.js";
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
  bot.command("terms", paidVpnTermsHandler);
  bot.command("paysupport", paidVpnSupportHandler);
  bot.command("add", paidVpnAdminOnly(), paidVpnAddHandler);
  bot.command("remove", paidVpnAdminOnly(), paidVpnRemoveHandler);
  bot.action("vpn_status", async (ctx) => showPaidVpnScreen(ctx));
  bot.action("vpn_buy", paidVpnBuyHandler);
  bot.action("vpn_stars_help", paidVpnStarsHelpHandler);
  bot.action("vpn_trial_start", paidVpnTrialStartHandler);
  bot.action("vpn_buy_confirm", paidVpnBuyConfirmHandler);
  bot.action("vpn_cancel", paidVpnCancelHandler);
  bot.action("vpn_cancel_confirm", paidVpnCancelConfirmHandler);
  bot.on("pre_checkout_query", paidVpnPreCheckoutHandler);
  bot.on("message", paidVpnSuccessfulPaymentHandler);
  bot.use(async (ctx, next) => {
    if (extractBotSubscriptionUpdate(ctx)) {
      await paidVpnSubscriptionUpdatedHandler(ctx);
      return;
    }
    return next();
  });
  return bot;
}
