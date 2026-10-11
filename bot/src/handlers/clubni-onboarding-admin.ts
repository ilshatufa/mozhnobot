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

  const progress = await ctx.reply("Получил видео. Готовлю расшифровку…");
  try {
    const configured = await configureClubniOnboardingVideo1(ctx.telegram, {
      fileId: video.file_id,
      fileUniqueId: video.file_unique_id,
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progress.message_id,
      undefined,
      "Видео 1 сохранено. Расшифровка готова: если Telegram запретит видео, пользователь получит текст и сможет продолжить онбординг.",
    );
    logger.info("Clubni onboarding video 1 configured", {
      adminTelegramId: ctx.from?.id ?? null,
      fileUniqueId: configured.fileUniqueId,
      transcriptLength: configured.transcript.length,
    });
  } catch (error) {
    logger.error("Failed to configure Clubni onboarding video 1", {
      adminTelegramId: ctx.from?.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progress.message_id,
      undefined,
      "Не удалось сохранить видео или подготовить расшифровку. Предыдущее видео не изменено.",
    );
  }
};
