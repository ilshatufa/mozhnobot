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
    if (ctx.chat?.type !== "private" || ctx.updateType !== "message" || !ctx.from?.id) return;

    const seenAt = new Date();
    const dbUser = await userRepository.upsertFromTelegramUser(ctx.from, seenAt);
    ctx.dbUser = dbUser;
    ctx.isPaidVpnAdmin = config.vpnBot.adminTelegramId === BigInt(ctx.from.id);

    if (dbUser.isBanned) {
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
