import { ClubMembershipStatus, type User } from "@prisma/client";
import { type Context, type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import {
  clubniOnboardingState,
  findLatestClubniPayment,
} from "../services/clubni-payment.service.js";

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
  onboarding = false,
  body?: string,
): string {
  const username = from.username ? `@${from.username}` : "без @username";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  return [
    `${username}${name ? ` · ${name}` : ""}`,
    `В клубе: ${clubMembershipLabel(user)}${onboarding ? " · #онбординг" : ""}`,
    ...(body ? ["", body] : []),
  ].join("\n");
}

function escapeRichMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");
}

export function botInboxRichMarkdown(
  from: { id: number; username?: string; first_name: string; last_name?: string },
  user: Pick<User, "clubStatus" | "joinedAt">,
  onboarding = false,
  body?: string,
  mediaBlock?: string,
): string {
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  const identity = from.username
    ? `[@${from.username}](https://t.me/${from.username})${name ? ` · ${escapeRichMarkdown(name)}` : ""}`
    : `[${escapeRichMarkdown(name || "Пользователь")}](tg://user?id=${from.id})`;
  const blocks = [[
    `# ${identity}`,
    `**В клубе:** ${clubMembershipLabel(user)}${onboarding ? " · #онбординг" : ""}`,
  ].join("\n")];
  if (body) blocks.push("⠀", escapeRichMarkdown(body));
  if (mediaBlock) blocks.push(mediaBlock);
  return blocks.join("\n\n");
}

type RichMedia = {
  markdownBlock: string;
  media?: Array<{
    id: string;
    media: { type: string; media: string };
  }>;
};

async function richMediaForMessage(
  ctx: Context,
  message: NonNullable<Context["message"]>,
): Promise<RichMedia | null> {
  const id = "content";
  if ("photo" in message) {
    const photo = message.photo.at(-1);
    return photo ? {
      markdownBlock: `![](tg://photo?id=${id})`,
      media: [{ id, media: { type: "photo", media: photo.file_id } }],
    } : null;
  }
  if ("video" in message) {
    return {
      markdownBlock: `![](tg://video?id=${id})`,
      media: [{ id, media: { type: "video", media: message.video.file_id } }],
    };
  }
  if ("document" in message) {
    return {
      markdownBlock: `![](tg://document?id=${id})`,
      media: [{ id, media: { type: "document", media: message.document.file_id } }],
    };
  }
  if ("voice" in message) {
    return {
      markdownBlock: `![](tg://audio?id=${id})`,
      media: [{ id, media: { type: "voice_note", media: message.voice.file_id } }],
    };
  }
  if ("video_note" in message) {
    const link = await ctx.telegram.getFileLink(message.video_note.file_id);
    return { markdownBlock: `![](${link.toString()})` };
  }
  return null;
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

    let onboarding = false;
    if (config.clubniPayment.enabled) {
      const payment = await findLatestClubniPayment(
        from.id,
        config.clubniPayment.clubId,
        clubEventRepository,
      );
      onboarding = payment !== null &&
        await clubniOnboardingState(payment, clubEventRepository) !== "final";
    }

    try {
      const body = "text" in message
        ? message.text
        : "caption" in message
          ? message.caption
          : undefined;
      const richMedia = await richMediaForMessage(ctx, message);
      try {
        await ctx.telegram.callApi("sendRichMessage" as never, {
          chat_id: destination,
          rich_message: {
            markdown: botInboxRichMarkdown(
              from,
              user,
              onboarding,
              body,
              richMedia?.markdownBlock,
            ),
            ...(richMedia?.media ? { media: richMedia.media } : {}),
          },
        } as never) as { message_id: number };
      } catch (error) {
        logger.warn("Failed to send rich bot inbox message, using Telegram copy", {
          telegramUserId: from.id,
          error: error instanceof Error ? error.message : String(error),
        });
        if ("text" in message) {
          await ctx.telegram.sendMessage(
            destination,
            botInboxHeader(from, user, onboarding, message.text),
          );
        } else {
          await ctx.telegram.copyMessage(destination, ctx.chat.id, message.message_id, {
            caption: botInboxHeader(from, user, onboarding, body),
          });
        }
      }
    } catch (error) {
      logger.error("Failed to copy private bot message to inbox group", {
        telegramUserId: from.id,
        telegramMessageId: message.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return next();
  };
}
