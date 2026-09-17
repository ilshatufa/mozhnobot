import { type User } from "@prisma/client";
import { type Context, type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { PAID_VPN_BANNED_TEXT } from "../paid-vpn-copy.js";
import { userRepository } from "../repositories/user.repository.js";

export interface PaidVpnContext extends Context {
  dbUser: User;
  isPaidVpnAdmin: boolean;
}

export function paidVpnAuthMiddleware(): MiddlewareFn<PaidVpnContext> {
  return async (ctx, next) => {
    const rawUpdate = ctx.update as unknown as {
      subscription?: { user?: { id: number; username?: string; first_name: string; last_name?: string; is_bot: boolean } };
      pre_checkout_query?: { from?: { id: number; username?: string; first_name: string; last_name?: string; is_bot: boolean } };
    };
    const telegramUser = ctx.from ?? rawUpdate.subscription?.user ?? rawUpdate.pre_checkout_query?.from;
    if (!telegramUser?.id) return;

    const isPrivateChatUpdate = ctx.chat?.type === "private" &&
      (ctx.updateType === "message" || ctx.updateType === "callback_query");
    const isPaymentUpdate = Boolean(rawUpdate.pre_checkout_query || rawUpdate.subscription);
    if (!isPrivateChatUpdate && !isPaymentUpdate) return;
    const message = ctx.message;
    const isConfirmedPayment = Boolean(message && "successful_payment" in message);

    const seenAt = new Date();
    const dbUser = await userRepository.upsertFromTelegramUser(telegramUser, seenAt);
    ctx.dbUser = dbUser;
    ctx.isPaidVpnAdmin = config.vpnBot.adminTelegramId === BigInt(telegramUser.id);

    if (dbUser.isBanned && isPrivateChatUpdate && !isConfirmedPayment) {
      await ctx.reply(PAID_VPN_BANNED_TEXT);
      return;
    }

    return next();
  };
}

export function paidVpnAdminOnly(): MiddlewareFn<PaidVpnContext> {
  return async (ctx, next) => {
    if (!ctx.isPaidVpnAdmin) {
      await ctx.reply("У тебя нет прав для этой команды.");
      return;
    }
    return next();
  };
}
