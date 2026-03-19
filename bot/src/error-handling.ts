import type { Context } from "telegraf";
import { logger } from "./logger.js";
import { isBotBlockedError } from "./telegram-errors.js";

type TelegramApiError = {
  code?: unknown;
  description?: unknown;
  response?: {
    error_code?: unknown;
    description?: unknown;
  };
};

function getTelegramErrorDetails(error: unknown): { code: number | null; description: string | null } {
  if (!error || typeof error !== "object") {
    return { code: null, description: null };
  }

  const telegramError = error as TelegramApiError;
  const code =
    typeof telegramError.response?.error_code === "number"
      ? telegramError.response.error_code
      : typeof telegramError.code === "number"
        ? telegramError.code
        : null;
  const description =
    typeof telegramError.response?.description === "string"
      ? telegramError.response.description
      : typeof telegramError.description === "string"
        ? telegramError.description
        : null;

  return { code, description };
}

function buildUpdateMeta(ctx: Context): Record<string, unknown> {
  return {
    updateType: ctx.updateType,
    updateId: ctx.update.update_id,
    fromId: ctx.from?.id ?? null,
    chatId: ctx.chat?.id ?? null,
    chatType: ctx.chat?.type ?? null,
  };
}

export function handleBotError(error: unknown, ctx: Context): void {
  const meta = buildUpdateMeta(ctx);

  if (isBotBlockedError(error)) {
    logger.info("User blocked the bot", meta);
    return;
  }

  const telegram = getTelegramErrorDetails(error);
  if (telegram.code !== null || telegram.description !== null) {
    logger.error("Telegram API error while processing update", {
      ...meta,
      telegramCode: telegram.code,
      telegramDescription: telegram.description,
      error,
    });
    return;
  }

  logger.error("Unhandled bot error while processing update", {
    ...meta,
    error,
  });
}

let processHandlersRegistered = false;

export function registerProcessErrorHandlers(): void {
  if (processHandlersRegistered) {
    return;
  }
  processHandlersRegistered = true;

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason });
  });

  process.on("uncaughtException", (error) => {
    logger.fatal("Uncaught exception", error);
  });
}
