import { logger } from "../logger.js";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";
import {
  PAID_VPN_BLOCKED_TEXT,
  PAID_VPN_NO_ACCESS_TEXT,
  PAID_VPN_START_TEXT,
  parseAddUsername,
} from "../paid-vpn-copy.js";
import { userRepository } from "../repositories/user.repository.js";
import { vpnService } from "../services/vpn.service.js";
import { buildSetupInstructions } from "./vpn.js";

const ADD_USAGE_TEXT = "Использование: /add @username";
const ACCESS_PROGRESS_TEXT = "Проверяю доступ и готовлю личную ссылку…";
const ADD_PROGRESS_TEXT = "Подключаю бесплатный доступ…";

async function editProgress(ctx: PaidVpnContext, messageId: number, text: string): Promise<void> {
  if (!ctx.chat) return;
  await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text);
}

export async function paidVpnStartHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.reply(PAID_VPN_START_TEXT, { parse_mode: "HTML" });
}

export async function paidVpnAccessHandler(ctx: PaidVpnContext): Promise<void> {
  if (ctx.dbUser.vpnBlocked) {
    await ctx.reply(PAID_VPN_BLOCKED_TEXT);
    return;
  }

  const progress = await ctx.reply(ACCESS_PROGRESS_TEXT);
  try {
    const result = await vpnService.getPaidKey(ctx.dbUser);
    if (!result) {
      await editProgress(ctx, progress.message_id, PAID_VPN_NO_ACCESS_TEXT);
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) throw new Error("Private chat is unavailable");
    await ctx.telegram.editMessageText(
      chatId,
      progress.message_id,
      undefined,
      buildSetupInstructions(result.key.subscriptionUrl),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  } catch (error) {
    logger.error("paidVpnAccessHandler failed", { userId: ctx.dbUser.id, error });
    await editProgress(ctx, progress.message_id, "Не удалось проверить доступ. Попробуй ещё раз позже.");
  }
}

export async function paidVpnAddHandler(ctx: PaidVpnContext): Promise<void> {
  const message = ctx.message;
  if (!message || !("text" in message)) {
    await ctx.reply(ADD_USAGE_TEXT);
    return;
  }

  const parsed = parseAddUsername(message.text);
  if (!parsed.ok) {
    await ctx.reply(ADD_USAGE_TEXT);
    return;
  }

  const matches = await userRepository.findManyByUsername(parsed.username);
  if (matches.length === 0) {
    await ctx.reply(`Пользователь @${parsed.username} ещё не запускал бота. Попроси его отправить /start.`);
    return;
  }
  if (matches.length > 1) {
    await ctx.reply(`Нашлось несколько пользователей с именем @${parsed.username}. Попроси нужного пользователя отправить /start и повтори команду.`);
    return;
  }

  const target = matches[0];
  if (target.isBanned || target.vpnBlocked) {
    await ctx.reply(`Для @${parsed.username} действует блокировка. Сначала сними её в клубном боте.`);
    return;
  }

  const progress = await ctx.reply(ADD_PROGRESS_TEXT);
  try {
    const result = await vpnService.grantFreeUnlimitedPaidAccess(target);
    const resultText = result.alreadyGranted
      ? `У @${parsed.username} уже есть бесплатный безлимитный доступ.`
      : `Бесплатный безлимитный доступ для @${parsed.username} включён.`;
    await editProgress(ctx, progress.message_id, resultText);
  } catch (error) {
    logger.error("paidVpnAddHandler failed", {
      adminUserId: ctx.dbUser.id,
      targetUserId: target.id,
      error,
    });
    await editProgress(ctx, progress.message_id, "Не удалось подключить доступ. Проверь настройку платного продукта и повтори команду.");
  }
}
