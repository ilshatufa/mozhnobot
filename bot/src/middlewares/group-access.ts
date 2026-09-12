import { type Context, type MiddlewareFn } from "telegraf";
import { logger } from "../logger.js";
import {
  groupAccessService,
  type ChatMemberUpdateLike,
} from "../services/group-access.service.js";
import { config } from "../config.js";

export type RemovalServiceMessageLike = {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  left_chat_member?: { id: number };
};

type GroupAccessUpdateLike = {
  message?: RemovalServiceMessageLike;
  chat_member?: ChatMemberUpdateLike;
};

export function isOwnRemovalServiceMessage(
  message: RemovalServiceMessageLike,
  botId: number,
  managedChatIds: readonly string[],
): boolean {
  return Boolean(
    managedChatIds.includes(String(message.chat.id)) &&
      message.from?.id === botId &&
      message.left_chat_member &&
      message.left_chat_member.id !== botId,
  );
}

export function groupAccessMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const update = ctx.update as typeof ctx.update & GroupAccessUpdateLike;

    if (
      config.groupAccess.enabled &&
      update.message &&
      isOwnRemovalServiceMessage(
        update.message,
        ctx.botInfo.id,
        config.groupAccess.managedChatIds,
      )
    ) {
      try {
        await ctx.telegram.deleteMessage(update.message.chat.id, update.message.message_id);
        logger.info("Deleted bot-owned member removal service message", {
          chatId: String(update.message.chat.id),
          messageId: update.message.message_id,
          removedUserId: String(update.message.left_chat_member?.id),
        });
      } catch (error) {
        logger.error("Failed to delete bot-owned member removal service message", error);
      }
    }

    if (update.chat_member) {
      try {
        await groupAccessService.handleChatMember(update.chat_member, ctx.telegram);
      } catch (error) {
        logger.error("Failed to handle group access event", error);
      }
    }

    return next();
  };
}
