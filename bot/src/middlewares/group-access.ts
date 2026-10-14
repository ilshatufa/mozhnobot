import { type Context, type MiddlewareFn } from "telegraf";
import { logger } from "../logger.js";
import {
  groupAccessService,
  isJoinTransition,
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
export type ClubJoinReason = "invite_link" | "join_request" | "added" | "self";

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

export function classifyClubJoin(update: ChatMemberUpdateLike): ClubJoinReason | null {
  if (!isJoinTransition(update)) return null;
  if (update.via_join_request) return "join_request";
  if (update.invite_link || update.via_chat_folder_invite_link) return "invite_link";
  if (update.from.id !== update.new_chat_member.user.id) return "added";
  return "self";
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

export function clubJoinNotification(
  update: ChatMemberUpdateLike,
  reason: ClubJoinReason,
): string {
  const member = telegramUserLabel(update.new_chat_member.user);
  const occurredAt = CLUB_EVENT_TIME_FORMATTER.format(new Date(update.date * 1000));
  const heading = reason === "invite_link"
    ? "🔗 <b>Вступил в клуб по ссылке</b>"
    : reason === "join_request"
      ? "✅ <b>Вступил в клуб по заявке</b>"
      : reason === "added"
        ? "➕ <b>Добавлен в клуб</b>"
        : "👋 <b>Вступил в клуб самостоятельно</b>";
  const actor = reason === "added"
    ? `\nДобавил: ${telegramUserLabel(update.from)}`
    : reason === "join_request"
      ? `\nОдобрил: ${telegramUserLabel(update.from)}`
      : "";
  const inviteName = reason === "invite_link" && update.invite_link?.name
    ? `\nСсылка: ${escapeHtml(update.invite_link.name)}`
    : "";

  return `${heading}\n\n${member}${actor}${inviteName}\n🕒 ${occurredAt} (Екатеринбург)`;
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
        const departureReason = classifyClubDeparture(update.chat_member, ctx.botInfo?.id);
        const joinReason = classifyClubJoin(update.chat_member);
        const notification = departureReason
          ? clubDepartureNotification(update.chat_member, departureReason)
          : joinReason
            ? clubJoinNotification(update.chat_member, joinReason)
            : null;
        if (notification) {
          try {
            await ctx.telegram.sendMessage(
              config.botInboxGroupId,
              notification,
              {
                parse_mode: "HTML",
                link_preview_options: { is_disabled: true },
              },
            );
          } catch (error) {
            logger.error("Failed to send club membership notification", error);
          }
        }
      }
    }

    return next();
  };
}
