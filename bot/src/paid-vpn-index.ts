import { config } from "./config.js";
import { prisma } from "./database.js";
import { registerProcessErrorHandlers } from "./error-handling.js";
import { logger } from "./logger.js";
import { createPaidVpnBot } from "./paid-vpn-bot.js";

async function configureCommands(bot: ReturnType<typeof createPaidVpnBot>): Promise<void> {
  await bot.telegram.setMyCommands([
    { command: "start", description: "Открыть МОЖНО VPN" },
    { command: "vpn", description: "Получить инструкцию и личную ссылку" },
  ]);
}

async function main(): Promise<void> {
  if (!config.vpnBot.token) throw new Error("VPN_BOT_TOKEN is required");
  if (!config.vpnBot.adminTelegramId) throw new Error("VPN_BOT_ADMIN_TELEGRAM_ID is required");

  await prisma.$connect();
  logger.info("Paid VPN bot database connected");

  const bot = createPaidVpnBot();
  await configureCommands(bot);

  const shutdown = async (signal: string) => {
    logger.info(`Paid VPN bot received ${signal}, shutting down`);
    bot.stop(signal);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await bot.launch({ allowedUpdates: ["message"] });
  logger.info("Paid VPN bot started");
}

registerProcessErrorHandlers();
main().catch((error) => {
  logger.fatal("Failed to start paid VPN bot", error);
  process.exit(1);
});
