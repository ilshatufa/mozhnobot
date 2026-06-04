import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { type AuthContext, authMiddleware, adminOnly } from "./middlewares/auth.js";
import { eventLoggerMiddleware } from "./middlewares/event-logger.js";
import { startHandler } from "./handlers/start.js";
import { helpHandler } from "./handlers/help.js";
import { vpnHandler, statusHandler } from "./handlers/vpn.js";
import { statsHandler } from "./handlers/stats.js";
import {
  transcriptionOffHandler,
  transcriptionOnHandler,
  transcriptionStatusHandler,
} from "./handlers/transcription-admin.js";
import {
  adminPhotoIdHandler,
  blockHandler,
  unblockHandler,
  banHandler,
  unbanHandler,
  promoteHandler,
  usersHandler,
} from "./handlers/admin.js";
import { handleBotError } from "./error-handling.js";

export function createBot(): Telegraf<AuthContext> {
  const bot = new Telegraf<AuthContext>(config.botToken);

  bot.catch((err, ctx) => {
    void handleBotError(err, ctx);
  });

  bot.use(eventLoggerMiddleware());
  bot.use(authMiddleware());

  bot.command("start", startHandler);
  bot.command("help", helpHandler);
  bot.command("vpn", vpnHandler);
  bot.command("status", statusHandler);

  bot.command("block", adminOnly(), blockHandler);
  bot.command("unblock", adminOnly(), unblockHandler);
  bot.command("ban", adminOnly(), banHandler);
  bot.command("unban", adminOnly(), unbanHandler);
  bot.command("promote", adminOnly(), promoteHandler);
  bot.command("users", adminOnly(), usersHandler);
  bot.command("stats", adminOnly(), statsHandler);
  bot.command("transcription_on", adminOnly(), transcriptionOnHandler);
  bot.command("transcription_off", adminOnly(), transcriptionOffHandler);
  bot.command("transcription_status", adminOnly(), transcriptionStatusHandler);
  bot.on("photo", adminPhotoIdHandler);

  return bot;
}
