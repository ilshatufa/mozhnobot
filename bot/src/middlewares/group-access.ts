import { type Context, type MiddlewareFn } from "telegraf";
import { logger } from "../logger.js";
import {
  groupAccessService,
  isLeaveTransition,
  type ChatMemberUpdateLike,
} from "../services/group-access.service.js";
import { config } from "../config.js";

const TRIBUTE_TELEGRAM_ID = 6675346585;
const CLUB_EVENT_TIME_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Yekaterinburg",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type ClubDepartureReason = "self" | "tribute" | "mozhno" | "clubni" | "other";

export type MembershipServiceMessageLike = {
  message_id: number;
  chat: { id: number };
  new_chat_members?: { id: number }[];
  left_chat_member?: { id: number };
};

type GroupAccessUpdateLike = {
  message?: MembershipServiceMessageLike;
  chat_member?: ChatMemberUpdateLike;
};

export function shouldDeleteMembershipServiceMessage(
  message: MembershipServiceMessageLike,
  clubChatId: string,
  managedChatIds: readonly string[],
): boolean {
  const chatId = String(message.chat.id);
  const isJoin = Boolean(message.new_chat_members?.length);
  const isLeave = Boolean(message.left_chat_member);
  if (!isJoin && !isLeave) return false;
  return chatId === clubChatId || managedChatIds.includes(chatId);
}

export function classifyClubDeparture(
  update: ChatMemberUpdateLike,
  currentBotId?: number,
): ClubDepartureReason | null {
  if (!isLeaveTransition(update)) return null;

  const memberId = update.new_chat_member.user.id;
  const actor = update.from;
  const actorUsername = actor.username?.toLowerCase();

  if (actor.id === memberId) return "self";
  if (actor.id === TRIBUTE_TELEGRAM_ID || actorUsername === "tribute") return "tribute";
  if (actor.id === currentBotId || actorUsername === "mozhnoclub_bot") return "mozhno";
  if (actorUsername?.includes("clubni")) return "clubni";
  return "other";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function telegramUserLabel(user: ChatMemberUpdateLike["new_chat_member"]["user"]): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const escapedName = escapeHtml(name || `ID ${user.id}`);
  if (!user.username) return `<a href="tg://user?id=${user.id}">${escapedName}</a>`;

  const username = escapeHtml(user.username);
  return `<a href="https://t.me/${username}">@${username}</a>${name ? ` · ${escapedName}` : ""}`;
}

function actorLabel(actor: ChatMemberUpdateLike["from"]): string {
  if (actor.username) return `@${escapeHtml(actor.username)}`;
  const name = [actor.first_name, actor.last_name].filter(Boolean).join(" ");
  return escapeHtml(name || `ID ${actor.id}`);
}

export function clubDepartureNotification(
  update: ChatMemberUpdateLike,
  reason: ClubDepartureReason,
): string {
  const member = telegramUserLabel(update.new_chat_member.user);
  const occurredAt = CLUB_EVENT_TIME_FORMATTER.format(new Date(update.date * 1000));
  const heading = reason === "self"
    ? "🚪 <b>Вышел из клуба сам</b>"
    : reason === "tribute"
      ? "⛔️ <b>Удалён из клуба — Tribute</b>"
      : reason === "mozhno"
        ? "🤖 <b>Удалён из клуба — МожноБот</b>"
        : reason === "clubni"
          ? "🤖 <b>Удалён из клуба — Clubni</b>"
          : `⛔️ <b>Удалён из клуба — ${actorLabel(update.from)}</b>`;

  return `${heading}\n\n${member}\n🕒 ${occurredAt} (Екатеринбург)`;
}

export function groupAccessMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const update = ctx.update as typeof ctx.update & GroupAccessUpdateLike;

    if (
      config.groupAccess.enabled &&
      update.message &&
      shouldDeleteMembershipServiceMessage(
        update.message,
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

      if (
        config.botInboxGroupId &&
        String(update.chat_member.chat.id) === config.clubGroupId
      ) {
        const reason = classifyClubDeparture(update.chat_member, ctx.botInfo?.id);
        if (reason) {
          try {
            await ctx.telegram.sendMessage(
              config.botInboxGroupId,
              clubDepartureNotification(update.chat_member, reason),
              {
                parse_mode: "HTML",
                link_preview_options: { is_disabled: true },
              },
            );
          } catch (error) {
            logger.error("Failed to send club departure notification", error);
          }
        }
      }
    }

    return next();
  };
}
