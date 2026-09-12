import { type Context, type MiddlewareFn } from "telegraf";
import { logger } from "../logger.js";
import {
  groupAccessService,
  type ChatMemberUpdateLike,
} from "../services/group-access.service.js";

export function groupAccessMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const update = ctx.update as typeof ctx.update & { chat_member?: ChatMemberUpdateLike };
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
