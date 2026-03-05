import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { type AuthContext, authMiddleware, adminOnly } from "./middlewares/auth.js";
import { startHandler } from "./handlers/start.js";
import { vpnHandler, statusHandler } from "./handlers/vpn.js";
import {
  adminPhotoIdHandler,
  blockHandler,
  unblockHandler,
  banHandler,
  unbanHandler,
  promoteHandler,
  usersHandler,
} from "./handlers/admin.js";

export function createBot(): Telegraf<AuthContext> {
  const bot = new Telegraf<AuthContext>(config.botToken);

  bot.use(authMiddleware());

  bot.command("start", startHandler);
  bot.command("vpn", vpnHandler);
  bot.command("status", statusHandler);

  bot.command("block", adminOnly(), blockHandler);
  bot.command("unblock", adminOnly(), unblockHandler);
  bot.command("ban", adminOnly(), banHandler);
  bot.command("unban", adminOnly(), unbanHandler);
  bot.command("promote", adminOnly(), promoteHandler);
  bot.command("users", adminOnly(), usersHandler);
  bot.on("photo", adminPhotoIdHandler);

  return bot;
}
