import { type Context, type MiddlewareFn } from "telegraf";
import { Role, type User } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { userRepository } from "../repositories/user.repository.js";
import { isBotBlockedError } from "../telegram-errors.js";

export interface AuthContext extends Context {
  dbUser: User;
}

const ALLOWED_STATUSES = new Set(["member", "administrator", "creator"]);

export function authMiddleware(): MiddlewareFn<AuthContext> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Обрабатываем только личные сообщения/команды пользователя.
    if (ctx.chat?.type !== "private" || ctx.updateType !== "message") return;

    const tgId = BigInt(telegramId);

    let dbUser = await userRepository.findByTelegramId(tgId);

    if (dbUser?.isBanned) {
      await ctx.reply("Вы заблокированы. Обратитесь к администратору.");
      return;
    }

    try {
      const member = await ctx.telegram.getChatMember(config.clubGroupId, telegramId);
      if (!ALLOWED_STATUSES.has(member.status)) {
        await ctx.reply("Вы не являетесь участником клуба.");
        return;
      }
    } catch (err) {
      if (isBotBlockedError(err)) {
        logger.info(`Skipping auth for blocked bot user ${telegramId}`);
        return;
      }
      logger.error("getChatMember failed:", err);
      await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
      return;
    }

    dbUser = await userRepository.upsert(
      tgId,
      ctx.from?.username,
      ctx.from?.first_name,
    );

    // Seed-админ: если в БД нет ни одного ADMIN и это seed_admin_id
    if (dbUser.role === Role.USER && tgId === config.seedAdminId) {
      const hasAdmin = await userRepository.hasAnyAdmin();
      if (!hasAdmin) {
        dbUser = await userRepository.setRole(tgId, Role.ADMIN);
        logger.info(`Seed admin assigned: ${tgId}`);
      }
    }

    ctx.dbUser = dbUser;
    return next();
  };
}

export function adminOnly(): MiddlewareFn<AuthContext> {
  return async (ctx, next) => {
    if (ctx.dbUser?.role !== Role.ADMIN) {
      await ctx.reply("У вас нет прав для выполнения этой команды.");
      return;
    }
    return next();
  };
}
