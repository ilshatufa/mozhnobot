import { logger } from "./logger.js";
import { prisma } from "./database.js";
import { createBot } from "./bot.js";
import { config } from "./config.js";
import { registerProcessErrorHandlers } from "./error-handling.js";

const STARTUP_RETRY_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const STARTUP_RETRY_ATTEMPTS = 10;
const STARTUP_RETRY_DELAY_MS = 5000;

type ErrorWithCode = {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  cause?: unknown;
};

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const err = error as ErrorWithCode;

  if (typeof err.code === "string") {
    return err.code;
  }

  if (typeof err.errno === "string") {
    return err.errno;
  }

  return getErrorCode(err.cause);
}

function isRetriableStartupError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && STARTUP_RETRY_CODES.has(code)) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as ErrorWithCode;
  return typeof err.message === "string" && /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function launchBotWithRetry(bot: ReturnType<typeof createBot>): Promise<void> {
  for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await bot.launch({
        allowedUpdates: [
          "message",
          "edited_message",
          "message_reaction",
          "message_reaction_count",
          "chat_member",
          "my_chat_member",
          "chat_join_request",
          "callback_query",
        ],
      });
      return;
    } catch (error) {
      if (!isRetriableStartupError(error) || attempt === STARTUP_RETRY_ATTEMPTS) {
        throw error;
      }

      logger.warn("Bot launch failed with a transient network error, retrying", {
        attempt,
        maxAttempts: STARTUP_RETRY_ATTEMPTS,
        retryDelayMs: STARTUP_RETRY_DELAY_MS,
        errorCode: getErrorCode(error),
        error,
      });

      await sleep(STARTUP_RETRY_DELAY_MS);
    }
  }
}

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected");

  const bot = createBot();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    bot.stop(signal);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("Launching bot", {
    CLUB_GROUP_ID: config.clubGroupId,
    VPN_KEY_DURATION_DAYS: config.vpnKeyDurationDays,
    VPN_TRAFFIC_LIMIT_GB: config.vpnTrafficLimitGb,
  });
  await launchBotWithRetry(bot);
  logger.info("Bot started");
}

registerProcessErrorHandlers();

main().catch((err) => {
  logger.fatal("Failed to start:", err);
  process.exit(1);
});
