import { ClubMembershipStatus, type User } from "@prisma/client";
import { type Context, type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { userRepository } from "../repositories/user.repository.js";

export function clubMembershipLabel(
  user: Pick<User, "clubStatus" | "joinedAt">,
): string {
  if (user.clubStatus === ClubMembershipStatus.MEMBER) return "есть";
  if (
    user.joinedAt ||
    user.clubStatus === ClubMembershipStatus.LEFT ||
    user.clubStatus === ClubMembershipStatus.REMOVED
  ) {
    return "был(а)";
  }
  return "нет";
}

export function botInboxHeader(
  from: { id: number; username?: string; first_name: string; last_name?: string },
  user: Pick<User, "clubStatus" | "joinedAt">,
): string {
  const username = from.username ? `@${from.username}` : "без @username";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  return [
    `Пользователь: ${username}${name ? ` · ${name}` : ""}`,
    `В клубе: ${clubMembershipLabel(user)}`,
  ].join("\n");
}

export function shouldCopyToBotInbox(
  message: NonNullable<Context["message"]>,
): boolean {
  if ("text" in message) {
    const startsWithCommand = message.text.trimStart().startsWith("/");
    const hasCommandEntity = message.entities?.some(
      (entity) => entity.type === "bot_command" && entity.offset === 0,
    );
    return !startsWithCommand && !hasCommandEntity;
  }

  return (
    "voice" in message ||
    "video_note" in message ||
    "photo" in message ||
    "video" in message ||
    "document" in message
  );
}

export function botInboxMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const destination = config.botInboxGroupId;
    const message = ctx.message;
    const from = ctx.from;
    if (
      !destination ||
      !message ||
      !from ||
      from.is_bot ||
      ctx.chat?.type !== "private" ||
      !shouldCopyToBotInbox(message)
    ) {
      return next();
    }

    const user = await userRepository.findByTelegramId(BigInt(from.id));
    if (!user) return next();

    let headerMessageId: number | null = null;
    try {
      const header = await ctx.telegram.sendMessage(
        destination,
        botInboxHeader(from, user),
      );
      headerMessageId = header.message_id;
      await ctx.telegram.copyMessage(
        destination,
        ctx.chat.id,
        message.message_id,
        { reply_parameters: { message_id: header.message_id } },
      );
    } catch (error) {
      if (headerMessageId !== null) {
        await ctx.telegram.deleteMessage(destination, headerMessageId).catch(() => undefined);
      }
      logger.error("Failed to copy private bot message to inbox group", {
        telegramUserId: from.id,
        telegramMessageId: message.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return next();
  };
}
