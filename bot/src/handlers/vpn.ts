import { Input, Markup } from "telegraf";
import { VpnProvider } from "@prisma/client";
import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { config } from "../config.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { vpnService } from "../services/vpn.service.js";
import { createZip } from "../utils/zip.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const VPN_AMNEZIA_ACTION = "vpn:amneziya";
const VPN_AMNEZIA_ZIP_ACTION = "vpn:amneziya-zip";
const VPN_AMNEZIA_SERVER_ACTION = /^vpn:amneziya:([a-z0-9-]+)$/;
const VPN_XUI_ACTION = "vpn:xui";
const VPN_XUI_MULTI_ACTION = "vpn:xui:multi";
const VPN_XUI_SERVER_ACTION = /^vpn:xui:([a-z0-9-]+)$/;
const AMNEZIYA_SEND_LOCK_TTL_MS = 60_000;
const amneziyaSendLocks = new Map<string, number>();

function buildXuiSetupInstructions(subscriptionUrl: string): string {
  return [
    "Привет! Чтобы установить на свой телефон наш клубный VPN «МОЖНО», просто пройди по шагам:",
    "",
    "<b>1.</b> Эта ссылка — твоя подписка на Xray VPN, скопируй её в приложение как сказано в инструкции:",
    `<pre>${escapeHtml(subscriptionUrl)}</pre>`,
    "",
    "<b>2.</b> Выбери инструкцию для своего приложения:",
    "• INCY — ссылка будет добавлена",
    "• Happ — ссылка будет добавлена",
    "• V2Box — ссылка будет добавлена",
    "",
    "<b>3.</b> После добавления подписки выбери сервер и включи VPN.",
    "",
    "<i>Если не подключается</i>",
    "<i>• Обнови подписку в приложении</i>",
    "<i>• Проверь автонастройку даты и времени на устройстве</i>",
    "<i>• Попробуй другую сеть (Wi-Fi/мобильный интернет)</i>",
  ].join("\n");
}

function buildAmneziyaSetupInstructions(configFileName: string): string {
  return [
    "VPN «МОЖНО» через Amnezia готов.",
    "",
    "<b>1.</b> Установи приложение Amnezia VPN:",
    "• <a href=\"https://apps.apple.com/app/amnezia-vpn/id1600529900\">для iOS</a>",
    "• <a href=\"https://play.google.com/store/apps/details?id=org.amnezia.awg\">для Android</a>",
    "",
    "<b>2.</b> Добавь подключение одним из способов:",
    "• на телефоне проще всего отсканировать QR-код из следующего сообщения",
    `• или импортируй файл <code>${escapeHtml(configFileName)}</code>: в Telegram открой меню файла и выбери <b>Поделиться</b> / <b>Открыть в…</b>`,
    "",
    "<b>3.</b> Включи VPN в приложении.",
    "",
    "<i>Если не подключается</i>",
    "<i>• Проверь, что импортирован именно файл AmneziaWG</i>",
    "<i>• Попробуй мобильный интернет и Wi‑Fi</i>",
    "<i>• Если приложение попросит VPN-разрешение, разреши</i>",
  ].join("\n");
}

function buildAmneziyaZipInstructions(fileName: string): string {
  return [
    "VPN «МОЖНО» через AmneziyaWG готов.",
    "",
    `<b>1.</b> Установи приложение AmneziyaWG:`,
    "• <a href=\"https://apps.apple.com/app/amneziawg/id6478942365\">для iOS</a>",
    "• <a href=\"https://play.google.com/store/apps/details?id=org.amnezia.awg\">для Android</a>",
    "",
    `<b>2.</b> Импортируй архив <code>${escapeHtml(fileName)}</code> через <b>Import from file or archive</b>.`,
    "",
    "<b>3.</b> Выбери нужный сервер и включи VPN.",
    "",
    "<i>Если архив не импортируется</i>",
    "<i>• Вернись к выбору AmneziyaWG и скачай отдельный .conf для нужного сервера</i>",
    "<i>• На iOS попробуй открыть архив через «Поделиться» / «Открыть в…»</i>",
  ].join("\n");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}

function remainingTime(expiresAt: Date): string {
  const diff = expiresAt.getTime() - Date.now();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;

  if (days > 0) return `${days} дн. ${remainHours} ч.`;
  return `${remainHours} ч.`;
}

export async function vpnHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  await ctx.reply(
    "Выберите VPN-подключение:",
    Markup.inlineKeyboard([
      [Markup.button.callback("AmneziyaWG", VPN_AMNEZIA_ACTION)],
      [Markup.button.callback("Happ/V2Box/INCY", VPN_XUI_ACTION)],
    ])
  );
}

export async function xuiVpnCallbackHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  try {
    await sendXuiMultiKey(ctx);
  } catch (err) {
    logger.error("xuiVpnCallbackHandler error:", err);
    await ctx.reply("Не удалось создать общую VPN-ссылку, попробуйте позже.");
  }
}

export async function xuiServerVpnCallbackHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  const serverCode = getXuiServerCode(ctx);
  if (!serverCode) {
    await ctx.reply("Не удалось определить сервер 3X-UI.");
    return;
  }

  try {
    await sendXuiKey(ctx, serverCode);
  } catch (err) {
    logger.error("xuiServerVpnCallbackHandler error:", err);
    await ctx.reply("Не удалось создать VPN-ключ, попробуйте позже.");
  }
}

export async function xuiMultiVpnCallbackHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  try {
    await sendXuiMultiKey(ctx);
  } catch (err) {
    logger.error("xuiMultiVpnCallbackHandler error:", err);
    await ctx.reply("Не удалось создать общую VPN-ссылку, попробуйте позже.");
  }
}

async function sendXuiKey(ctx: AuthContext, serverCode: string): Promise<void> {
  const user = ctx.dbUser;

  try {
    await ctx.replyWithChatAction("upload_document");
    await removeInlineKeyboard(ctx);
    const result = await vpnService.getOrCreateXuiKey(user, serverCode);
    const { key } = result;
    const text = buildXuiSetupInstructions(key.subscriptionUrl);

    if (config.vpnSetupImageFileId2) {
      await ctx.replyWithMediaGroup([
        {
          type: "photo",
          media: config.vpnSetupImageFileId,
          caption: text,
          parse_mode: "HTML",
          show_caption_above_media: true,
        },
        {
          type: "photo",
          media: config.vpnSetupImageFileId2,
          show_caption_above_media: true,
        },
      ] as any);
      return;
    }

    await ctx.replyWithPhoto(config.vpnSetupImageFileId, {
      caption: text,
      parse_mode: "HTML",
      show_caption_above_media: true,
    } as any);
  } catch (err) {
    logger.error("sendXuiKey error:", err);
    throw err;
  }
}

async function sendXuiMultiKey(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  try {
    await ctx.replyWithChatAction("upload_document");
    await removeInlineKeyboard(ctx);
    const result = await vpnService.getOrCreateMultiXuiKey(user);
    const text = buildXuiSetupInstructions(result.key.subscriptionUrl);

    if (config.vpnSetupImageFileId2) {
      await ctx.replyWithMediaGroup([
        {
          type: "photo",
          media: config.vpnSetupImageFileId,
          caption: text,
          parse_mode: "HTML",
          show_caption_above_media: true,
        },
        {
          type: "photo",
          media: config.vpnSetupImageFileId2,
          show_caption_above_media: true,
        },
      ] as any);
      return;
    }

    await ctx.replyWithPhoto(config.vpnSetupImageFileId, {
      caption: text,
      parse_mode: "HTML",
      show_caption_above_media: true,
    } as any);
  } catch (err) {
    logger.error("sendXuiMultiKey error:", err);
    throw err;
  }
}

export async function amneziyaVpnCallbackHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  try {
    const servers = await vpnService.listAmneziyaServers();

    if (servers.length === 0) {
      await ctx.reply("Сейчас нет доступных серверов Amnezia.");
      return;
    }

    if (servers.length === 1) {
      await sendAmneziyaKey(ctx, servers[0].code);
      return;
    }

    await ctx.reply(
      "Выберите сервер AmneziyaWG или скачайте архив со всеми конфигурациями:",
      Markup.inlineKeyboard(
        [
          [Markup.button.callback("Все серверы ZIP", VPN_AMNEZIA_ZIP_ACTION)],
          ...servers.map((server) => [
            Markup.button.callback(server.name, `${VPN_AMNEZIA_ACTION}:${server.code}`),
          ]),
        ]
      )
    );
  } catch (err) {
    logger.error("amneziyaVpnCallbackHandler error:", err);
    await ctx.reply("Не удалось получить список серверов Amnezia, попробуйте позже.");
  }
}

export async function amneziyaZipVpnCallbackHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  try {
    await sendAmneziyaZip(ctx);
  } catch (err) {
    logger.error("amneziyaZipVpnCallbackHandler error:", err);
    await ctx.reply("Не удалось создать архив AmneziyaWG, попробуйте позже.");
  }
}

export async function amneziyaServerVpnCallbackHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  const serverCode = getAmneziyaServerCode(ctx);
  if (!serverCode) {
    await ctx.reply("Не удалось определить сервер Amnezia.");
    return;
  }

  try {
    await sendAmneziyaKey(ctx, serverCode);
  } catch (err) {
    logger.error("amneziyaServerVpnCallbackHandler error:", err);
    await ctx.reply("Не удалось создать Amnezia-ключ, попробуйте позже.");
  }
}

async function sendAmneziyaZip(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;
  const lockKey = `${user.id}:zip`;

  if (!acquireAmneziyaSendLock(lockKey)) {
    await ctx.reply("Архив уже готовится. Подождите несколько секунд.");
    return;
  }

  const timings: Record<string, number> = {};
  const totalStartedAt = Date.now();
  const zipFileName = "amneziya-mozhno.zip";

  try {
    await measure("chatAction", timings, () => ctx.replyWithChatAction("upload_document"));
    await removeInlineKeyboard(ctx);

    const configs = await measure("getOrCreateConfigs", timings, () => vpnService.getOrCreateAllAmneziyaConfigs(user));
    const zipBuffer = await measure("buildZip", timings, async () => createZip(
      configs.map((item) => ({
        name: item.configFileName,
        data: Buffer.from(item.configText, "utf8"),
      }))
    ));

    await measure("instructionReply", timings, () => ctx.reply(buildAmneziyaZipInstructions(zipFileName), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }));

    await measure("zipReplyUpload", timings, () => ctx.replyWithDocument(
      Input.fromBuffer(zipBuffer, zipFileName),
      {
        caption: `Архив AmneziyaWG: ${configs.length} конфигурации.`,
      }
    ));

    logger.info("Amnezia ZIP sent", {
      userId: user.id,
      telegramId: user.telegramId.toString(),
      servers: configs.map((item) => item.serverCode),
      totalMs: Date.now() - totalStartedAt,
      timings,
    });
  } catch (err) {
    logger.error("sendAmneziyaZip error:", err);
    throw err;
  } finally {
    releaseAmneziyaSendLock(lockKey);
  }
}

async function sendAmneziyaKey(ctx: AuthContext, serverCode: string): Promise<void> {
  const user = ctx.dbUser;
  const lockKey = `${user.id}:${serverCode}`;

  if (!acquireAmneziyaSendLock(lockKey)) {
    await ctx.reply("Ключ уже готовится. Подождите несколько секунд.");
    return;
  }

  const timings: Record<string, number> = {};
  const totalStartedAt = Date.now();

  try {
    await measure("chatAction", timings, () => ctx.replyWithChatAction("upload_document"));
    await removeInlineKeyboard(ctx);

    const result = await measure("getOrCreateKey", timings, () => vpnService.getOrCreateAmneziyaKey(user, serverCode));
    const instructionText = buildAmneziyaSetupInstructions(result.configFileName);

    await measure("instructionReply", timings, () => ctx.reply(instructionText, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }));

    let telegramQrFileId = result.key.telegramQrFileId;
    let telegramConfigFileId = result.key.telegramConfigFileId;

    if (typeof telegramQrFileId === "string" && telegramQrFileId.length > 0) {
      const cachedQrFileId = telegramQrFileId;
      await measure("qrReplyCached", timings, () => ctx.replyWithPhoto(cachedQrFileId, {
        caption: "QR-код для подключения Amnezia.",
      }));
    } else {
      const qrBuffer = Buffer.from(result.qrPngBase64, "base64");
      const qrMessage = await measure("qrReplyUpload", timings, () => ctx.replyWithPhoto(
        { source: qrBuffer },
        {
          caption: "QR-код для подключения Amnezia.",
        }
      ));
      telegramQrFileId = extractLargestPhotoFileId(qrMessage);
    }

    if (typeof telegramConfigFileId === "string" && telegramConfigFileId.length > 0) {
      const cachedConfigFileId = telegramConfigFileId;
      await measure("configReplyCached", timings, () => ctx.replyWithDocument(cachedConfigFileId, {
        caption: "Файл конфигурации Amnezia.",
      }));
    } else {
      const configBuffer = Buffer.from(result.configText, "utf8");
      const configMessage = await measure("configReplyUpload", timings, () => ctx.replyWithDocument(
        Input.fromBuffer(configBuffer, result.configFileName),
        {
          caption: "Файл конфигурации Amnezia.",
        }
      ));
      telegramConfigFileId = extractDocumentFileId(configMessage);
    }

    if (
      telegramQrFileId !== result.key.telegramQrFileId ||
      telegramConfigFileId !== result.key.telegramConfigFileId
    ) {
      await measure("saveTelegramFileIds", timings, () => vpnKeyRepository.updateTelegramFileIds(result.key.id, {
        telegramQrFileId,
        telegramConfigFileId,
      }));
    }

    logger.info("Amnezia key sent", {
      userId: user.id,
      telegramId: user.telegramId.toString(),
      serverCode,
      alreadyExisted: result.alreadyExisted,
      usedCachedQr: Boolean(result.key.telegramQrFileId),
      usedCachedConfig: Boolean(result.key.telegramConfigFileId),
      totalMs: Date.now() - totalStartedAt,
      timings,
    });
  } catch (err) {
    logger.error("sendAmneziyaKey error:", err);
    throw err;
  } finally {
    releaseAmneziyaSendLock(lockKey);
  }
}

function acquireAmneziyaSendLock(lockKey: string): boolean {
  const now = Date.now();
  const lockedUntil = amneziyaSendLocks.get(lockKey);

  if (lockedUntil && lockedUntil > now) {
    return false;
  }

  amneziyaSendLocks.set(lockKey, now + AMNEZIYA_SEND_LOCK_TTL_MS);
  return true;
}

function releaseAmneziyaSendLock(lockKey: string): void {
  amneziyaSendLocks.delete(lockKey);
}

async function measure<T>(label: string, timings: Record<string, number>, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings[label] = Date.now() - startedAt;
  }
}

async function removeInlineKeyboard(ctx: AuthContext): Promise<void> {
  if (!ctx.callbackQuery?.message) return;

  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (error) {
    logger.warn("Failed to remove Amnezia server inline keyboard", { error });
  }
}

function extractLargestPhotoFileId(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("photo" in message)) {
    return null;
  }

  const photos = (message as { photo?: Array<{ file_id?: string }> }).photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    return null;
  }

  return photos[photos.length - 1]?.file_id ?? null;
}

function extractDocumentFileId(message: unknown): string | null {
  if (!message || typeof message !== "object" || !("document" in message)) {
    return null;
  }

  return (message as { document?: { file_id?: string } }).document?.file_id ?? null;
}

export async function statusHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  const { status, keys } = await vpnService.getStatuses(user);

  switch (status) {
    case "blocked":
      await ctx.reply("Ваш доступ к VPN заблокирован.");
      break;
    case "active":
      const amneziyaKeys = keys.filter((key) => key.provider === VpnProvider.AMNEZIA);
      const amneziyaUsed = amneziyaKeys.reduce((sum, key) => sum + (key.trafficUsedBytes ?? 0n), 0n);
      const amneziyaLimit = user.vpnTrafficLimitBytes;
      const amneziyaSummary = amneziyaKeys.length === 0
        ? []
        : [
            "<b>Общий лимит Amnezia</b>",
            amneziyaLimit === null
              ? `Использовано: ${formatBytes(amneziyaUsed)}, без лимита по объёму`
              : `Использовано: ${formatBytes(amneziyaUsed)} из ${formatBytes(amneziyaLimit)}`,
            "",
          ];

      await ctx.reply([
        ...amneziyaSummary,
        "Активные VPN-ключи:",
        "",
        ...keys.map((key) => {
          const serverName = key.server?.name ?? key.provider;
          const traffic = key.trafficUsedBytes === null ? "" : `\nТрафик: ${formatBytes(key.trafficUsedBytes)}`;
          const limit = key.trafficLimitBytes === null ? "" : ` из ${formatBytes(key.trafficLimitBytes)}`;
          return [
            `<b>${escapeHtml(serverName)}</b>`,
            `Срок действия до: ${formatDate(key.expiresAt)}`,
            `Осталось: ${remainingTime(key.expiresAt)}${traffic}${limit}`,
          ].join("\n");
        }),
      ].join("\n\n"), { parse_mode: "HTML" });
      break;
    case "none":
      await ctx.reply("У вас нет VPN-ключа. Используйте /vpn для получения.");
      break;
  }
}

export const vpnActionHandlers = {
  amneziya: {
    action: VPN_AMNEZIA_ACTION,
    handler: amneziyaVpnCallbackHandler,
  },
  amneziyaZip: {
    action: VPN_AMNEZIA_ZIP_ACTION,
    handler: amneziyaZipVpnCallbackHandler,
  },
  amneziyaServer: {
    action: VPN_AMNEZIA_SERVER_ACTION,
    handler: amneziyaServerVpnCallbackHandler,
  },
  xui: {
    action: VPN_XUI_ACTION,
    handler: xuiVpnCallbackHandler,
  },
  xuiMulti: {
    action: VPN_XUI_MULTI_ACTION,
    handler: xuiMultiVpnCallbackHandler,
  },
  xuiServer: {
    action: VPN_XUI_SERVER_ACTION,
    handler: xuiServerVpnCallbackHandler,
  },
};

function getAmneziyaServerCode(ctx: AuthContext): string | null {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery && "data" in callbackQuery ? callbackQuery.data : "";
  const match = data.match(VPN_AMNEZIA_SERVER_ACTION);
  return match?.[1] ?? null;
}

function getXuiServerCode(ctx: AuthContext): string | null {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery && "data" in callbackQuery ? callbackQuery.data : "";
  const match = data.match(VPN_XUI_SERVER_ACTION);
  return match?.[1] ?? null;
}

function formatBytes(value: bigint): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Number(value);
  let unitIndex = 0;

  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${size} ${units[unitIndex]}`;
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
