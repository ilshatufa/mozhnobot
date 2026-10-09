import { type Context, type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";
import {
  deliverClubniPaymentWelcome,
  parseClubniPaymentCommand,
} from "../services/clubni-payment.service.js";

export function clubniPaymentMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!config.clubniPayment.enabled || config.clubniPayment.sourceBotTelegramId === null) {
      return next();
    }

    if (
      !ctx.from?.is_bot ||
      BigInt(ctx.from.id) !== config.clubniPayment.sourceBotTelegramId ||
      ctx.chat?.type !== "private" ||
      !ctx.message ||
      !("text" in ctx.message)
    ) {
      return next();
    }

    if (/^\/clubni_probe(?:\s|$)/.test(ctx.message.text)) {
      logger.info("Clubni bot-to-bot probe received", { sourceBotTelegramId: ctx.from.id });
      return;
    }

    if (!ctx.message.text.startsWith("/clubni_payment")) {
      return next();
    }

    const event = parseClubniPaymentCommand(ctx.message.text);
    if (!event) {
      logger.warn("Invalid Clubni payment event ignored", { sourceBotTelegramId: ctx.from.id });
      return;
    }

    const result = await deliverClubniPaymentWelcome(event, config.clubniPayment.clubId, {
      repository: clubEventRepository,
      sendMessage: (telegramUserId, text) => ctx.telegram.sendMessage(telegramUserId, text),
    });
    logger.info("Clubni payment event processed", {
      result,
      eventId: event.eventId,
      subscriptionId: event.subscriptionId,
      targetTelegramUserId: event.telegramUserId,
    });
  };
}
