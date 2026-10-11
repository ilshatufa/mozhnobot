import { Telegram } from "telegraf";
import { config } from "./config.js";
import { prisma } from "./database.js";
import { logger } from "./logger.js";
import { registerProcessErrorHandlers } from "./error-handling.js";
import { installGroupActionLogging } from "./services/group-action-logger.service.js";
import { mediaProcessingService } from "./services/media-processing.service.js";

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected");

  const telegram = new Telegram(config.botToken);
  installGroupActionLogging(telegram);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down media worker...`);
    mediaProcessingService.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  mediaProcessingService.start(telegram);
}

registerProcessErrorHandlers();

main().catch((err) => {
  logger.fatal("Failed to start media worker:", err);
  process.exit(1);
});
