import { type Context, type MiddlewareFn } from "telegraf";
import { Role, type User } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { userRepository } from "../repositories/user.repository.js";
import { isBotBlockedError } from "../telegram-errors.js";

export interface AuthContext extends Context {
  dbUser: User;
  isClubMember: boolean;
}

const ALLOWED_STATUSES = new Set(["member", "administrator", "creator"]);
const CLUB_WAITLIST_ACTIONS = new Set(["club_waitlist_join", "club_avito_guide"]);

function isStartCommand(ctx: Context): boolean {
  const message = ctx.message;
  return Boolean(message && "text" in message && /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text));
}

function isWaitlistAction(ctx: Context): boolean {
  const callbackQuery = ctx.callbackQuery;
  return Boolean(
    callbackQuery &&
      "data" in callbackQuery &&
      CLUB_WAITLIST_ACTIONS.has(callbackQuery.data),
  );
}

export function authMiddleware(): MiddlewareFn<AuthContext> {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Обрабатываем только личные сообщения и callback-и пользователя.
    if (
      ctx.chat?.type !== "private" ||
      (ctx.updateType !== "message" && ctx.updateType !== "callback_query")
    ) {
      return;
    }

    const tgId = BigInt(telegramId);

    let dbUser = await userRepository.findByTelegramId(tgId);

    if (dbUser?.isBanned) {
      await ctx.reply("Вы заблокированы. Обратитесь к администратору.");
      return;
    }

    if (dbUser?.role === Role.ADMIN) {
      ctx.dbUser = await userRepository.upsert(
        tgId,
        ctx.from?.username,
        ctx.from?.first_name,
      );
      ctx.isClubMember = true;
      return next();
    }

    if (tgId === config.seedAdminId) {
      const hasAdmin = await userRepository.hasAnyAdmin();
      if (!hasAdmin) {
        dbUser = await userRepository.upsert(
          tgId,
          ctx.from?.username,
          ctx.from?.first_name,
        );
        ctx.dbUser = await userRepository.setRole(tgId, Role.ADMIN);
        ctx.isClubMember = true;
        logger.info(`Seed admin assigned: ${tgId}`);
        return next();
      }
    }

    try {
      const member = await ctx.telegram.getChatMember(config.clubGroupId, telegramId);
      const isClubMember =
        ALLOWED_STATUSES.has(member.status) ||
        (member.status === "restricted" && member.is_member);

      if (!isClubMember) {
        dbUser = await userRepository.upsert(
          tgId,
          ctx.from?.username,
          ctx.from?.first_name,
        );
        ctx.dbUser = dbUser;
        ctx.isClubMember = false;

        if (isStartCommand(ctx) || isWaitlistAction(ctx)) {
          return next();
        }

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

    ctx.dbUser = dbUser;
    ctx.isClubMember = true;
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
