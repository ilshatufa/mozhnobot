import { type Context, type MiddlewareFn } from "telegraf";
import { logger } from "../logger.js";
import {
  groupAccessService,
  type ChatMemberUpdateLike,
} from "../services/group-access.service.js";
import { config } from "../config.js";

export type MembershipServiceMessageLike = {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  new_chat_members?: { id: number }[];
  left_chat_member?: { id: number };
};

type GroupAccessUpdateLike = {
  message?: MembershipServiceMessageLike;
  chat_member?: ChatMemberUpdateLike;
};

export function shouldDeleteMembershipServiceMessage(
  message: MembershipServiceMessageLike,
  botId: number,
  clubChatId: string,
  managedChatIds: readonly string[],
): boolean {
  const chatId = String(message.chat.id);
  const isJoin = Boolean(message.new_chat_members?.length);
  const isLeave = Boolean(message.left_chat_member);
  if (!isJoin && !isLeave) return false;
  if (chatId === clubChatId) return true;

  return Boolean(
    managedChatIds.includes(chatId) &&
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
      shouldDeleteMembershipServiceMessage(
        update.message,
        ctx.botInfo.id,
        config.clubGroupId,
        config.groupAccess.managedChatIds,
      )
    ) {
      try {
        await ctx.telegram.deleteMessage(update.message.chat.id, update.message.message_id);
        logger.info("Deleted membership service message", {
          chatId: String(update.message.chat.id),
          messageId: update.message.message_id,
          eventType: update.message.new_chat_members?.length ? "joined" : "left",
          memberIds: update.message.new_chat_members?.map(({ id }) => String(id)) ??
            [String(update.message.left_chat_member?.id)],
        });
      } catch (error) {
        logger.error("Failed to delete membership service message", error);
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
