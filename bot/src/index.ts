import { logger } from "./logger.js";
import { prisma } from "./database.js";
import { createBot } from "./bot.js";
import { config } from "./config.js";

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
  await bot.launch();
  logger.info("Bot started");
}

main().catch((err) => {
  logger.fatal("Failed to start:", err);
  process.exit(1);
});
