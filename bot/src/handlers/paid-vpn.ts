import { logger } from "../logger.js";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";
import {
  buildNoRemovableAccessText,
  buildPaidVpnAccessRemovedText,
  buildPendingAccessSavedText,
  buildPendingAccessRemovedText,
  PAID_VPN_BLOCKED_TEXT,
  PAID_VPN_NO_ACCESS_TEXT,
  PAID_VPN_PENDING_ACCESS_ERROR_TEXT,
  PAID_VPN_PENDING_ACCESS_PROGRESS_TEXT,
  PAID_VPN_PENDING_ACCESS_READY_TEXT,
  PAID_VPN_START_TEXT,
  parseAddUsername,
  parseRemoveUsername,
} from "../paid-vpn-copy.js";
import { userRepository } from "../repositories/user.repository.js";
import { vpnPendingAccessGrantRepository } from "../repositories/vpn-pending-access-grant.repository.js";
import { vpnService } from "../services/vpn.service.js";
import { buildSetupInstructions } from "./vpn.js";

const ADD_USAGE_TEXT = "Использование: /add @username";
const REMOVE_USAGE_TEXT = "Использование: /remove @username";
const ACCESS_PROGRESS_TEXT = "Проверяю доступ и готовлю личную ссылку…";
const ADD_PROGRESS_TEXT = "Подключаю бесплатный доступ…";
const REMOVE_PROGRESS_TEXT = "Отключаю бесплатный доступ…";

async function editProgress(ctx: PaidVpnContext, messageId: number, text: string): Promise<void> {
  if (!ctx.chat) return;
  await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text);
}

export async function paidVpnStartHandler(ctx: PaidVpnContext): Promise<void> {
  if (ctx.isPaidVpnAdmin && ctx.chat) {
    try {
      await ctx.telegram.setMyCommands(
        [
          { command: "start", description: "Открыть МОЖНО VPN" },
          { command: "vpn", description: "Получить инструкцию и личную ссылку" },
          { command: "add", description: "Выдать бесплатный доступ" },
          { command: "remove", description: "Убрать бесплатный доступ" },
        ],
        { scope: { type: "chat", chat_id: ctx.chat.id } },
      );
    } catch (error) {
      logger.warn("Failed to configure paid VPN admin commands", {
        adminUserId: ctx.dbUser.id,
        error,
      });
    }
  }

  const username = ctx.dbUser.username;
  const pendingGrant = username
    ? await vpnPendingAccessGrantRepository.findPending(username)
    : null;
  if (pendingGrant) {
    const progress = await ctx.reply(PAID_VPN_PENDING_ACCESS_PROGRESS_TEXT);
    try {
      await vpnService.grantFreeUnlimitedPaidAccess(ctx.dbUser);
      await vpnPendingAccessGrantRepository.markClaimed(pendingGrant.id, ctx.dbUser.id);
    } catch (error) {
      logger.error("Failed to activate pending paid VPN grant", {
        userId: ctx.dbUser.id,
        pendingGrantId: pendingGrant.id,
        error,
      });
      await editProgress(
        ctx,
        progress.message_id,
        PAID_VPN_PENDING_ACCESS_ERROR_TEXT,
      );
      return;
    }

    await editProgress(
      ctx,
      progress.message_id,
      PAID_VPN_PENDING_ACCESS_READY_TEXT,
    );
    return;
  }

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
    await vpnPendingAccessGrantRepository.save(parsed.username, ctx.dbUser.telegramId);
    await ctx.reply(buildPendingAccessSavedText(parsed.username));
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

export async function paidVpnRemoveHandler(ctx: PaidVpnContext): Promise<void> {
  const message = ctx.message;
  if (!message || !("text" in message)) {
    await ctx.reply(REMOVE_USAGE_TEXT);
    return;
  }

  const parsed = parseRemoveUsername(message.text);
  if (!parsed.ok) {
    await ctx.reply(REMOVE_USAGE_TEXT);
    return;
  }

  const pendingRemoved = await vpnPendingAccessGrantRepository.deletePending(parsed.username);
  const matches = await userRepository.findManyByUsername(parsed.username);
  if (matches.length === 0) {
    await ctx.reply(
      pendingRemoved
        ? buildPendingAccessRemovedText(parsed.username)
        : buildNoRemovableAccessText(parsed.username),
    );
    return;
  }
  if (matches.length > 1) {
    const prefix = pendingRemoved ? "Ожидающее разрешение удалено.\n\n" : "";
    await ctx.reply(
      `${prefix}Нашлось несколько пользователей с именем @${parsed.username}. Активный доступ не изменён. Попроси нужного пользователя отправить /start и повтори команду.`,
    );
    return;
  }

  const target = matches[0];
  const progress = await ctx.reply(REMOVE_PROGRESS_TEXT);
  try {
    const result = await vpnService.revokeFreeUnlimitedPaidAccess(target);
    const resultText = result.wasGranted
      ? buildPaidVpnAccessRemovedText(parsed.username)
      : pendingRemoved
        ? buildPendingAccessRemovedText(parsed.username)
        : buildNoRemovableAccessText(parsed.username);
    await editProgress(ctx, progress.message_id, resultText);
  } catch (error) {
    logger.error("paidVpnRemoveHandler failed", {
      adminUserId: ctx.dbUser.id,
      targetUserId: target.id,
      error,
    });
    await editProgress(
      ctx,
      progress.message_id,
      `Не получилось полностью отключить доступ для @${parsed.username}. Повтори /remove @${parsed.username}.`,
    );
  }
}
