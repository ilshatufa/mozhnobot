import { Role } from "@prisma/client";
import type { MiddlewareFn } from "telegraf";
import type { AuthContext } from "../middlewares/auth.js";
import { logger } from "../logger.js";
import { configureClubniOnboardingVideo1 } from "../services/clubni-onboarding-media.service.js";

const VIDEO_1_COMMAND = /^\/clubni_video1(?:@\w+)?\s*$/i;

export const clubniOnboardingVideoAdminHandler: MiddlewareFn<AuthContext> = async (ctx, next) => {
  const message = ctx.message;
  const command = message && "video" in message
    ? message.caption ?? ""
    : message && "text" in message
      ? message.text
      : "";
  const video = message && "video" in message
    ? message.video
    : message && "reply_to_message" in message &&
        message.reply_to_message && "video" in message.reply_to_message
      ? message.reply_to_message.video
      : null;
  if (
    ctx.chat?.type !== "private" ||
    !message ||
    !video ||
    !VIDEO_1_COMMAND.test(command)
  ) {
    return next();
  }

  if (ctx.dbUser.role !== Role.ADMIN) {
    await ctx.reply("У вас нет прав для выполнения этой команды.");
    return;
  }

  const progress = await ctx.reply("Сохраняю видео…");
  try {
    const result = await configureClubniOnboardingVideo1(ctx.telegram, {
      fileId: video.file_id,
      fileUniqueId: video.file_unique_id,
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progress.message_id,
      undefined,
      result.transcriptPrepared
        ? "Видео сохранено и установлено в онбординг. Расшифровка готова."
        : "Видео сохранено и установлено в онбординг.",
    );
    logger.info("Clubni onboarding video 1 configured", {
      adminTelegramId: ctx.from?.id ?? null,
      fileUniqueId: result.video.fileUniqueId,
      transcriptLength: result.video.transcript?.length ?? 0,
      transcriptPrepared: result.transcriptPrepared,
    });
    if (result.transcriptionError) {
      logger.warn("Clubni onboarding video 1 transcript was not prepared", {
        adminTelegramId: ctx.from?.id ?? null,
        fileUniqueId: result.video.fileUniqueId,
        error: result.transcriptionError,
      });
    }
  } catch (error) {
    logger.error("Failed to configure Clubni onboarding video 1", {
      adminTelegramId: ctx.from?.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progress.message_id,
      undefined,
      "Не удалось сохранить видео.",
    );
  }
};
