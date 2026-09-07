import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { config } from "../config.js";
import { vpnService } from "../services/vpn.service.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildSetupInstructions(subscriptionUrl: string): string {
  return [
    "Привет! Чтобы установить на свой телефон наш клубный VPN «МОЖНО», просто пройди по шагам:",
    "",
    "<b>1.</b> Сначала установи приложение V2Box:",
    "• <a href=\"https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690\">для iOS</a>",
    "• <a href=\"https://play.google.com/store/apps/details?id=dev.hexasoftware.v2box\">для Android</a>",
    "",
    "<b>2.</b> Эти буквы и цифры — ключ (нажми на него и скопируй):",
    `<pre>${escapeHtml(subscriptionUrl)}</pre>`,
    "",
    "<b>3.</b> Открой приложение:",
    "• Внизу нажми <b>Конфигурации</b> (если непонятно, см. картинку под этим текстом)",
    "• Сверху нажми кнопку <b>➕</b>",
    "• Выбери <b>Импортировать v2ray URI из буфера обмена</b>",
    "",
    "<b>4.</b> Подключайся — нажми <b>Connect</b>",
    "",
    "<i>Если не подключается</i>",
    "<i>• Обнови подписку в приложении</i>",
    "<i>• Проверь автонастройку даты и времени на устройстве</i>",
    "<i>• Попробуй другую сеть (Wi-Fi/мобильный интернет)</i>",
  ].join("\n");
}

export async function vpnHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  if (user.vpnBlocked) {
    await ctx.reply("Ваш доступ к VPN заблокирован. Обратитесь к администратору.");
    return;
  }

  try {
    const result = await vpnService.getOrCreateKey(user);
    const { key } = result;
    const text = buildSetupInstructions(key.subscriptionUrl);

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
    logger.error("vpnHandler error:", err);
    await ctx.reply("Не удалось создать VPN-ключ, попробуйте позже.");
  }
}

export async function statusHandler(ctx: AuthContext): Promise<void> {
  const user = ctx.dbUser;

  const { status, key } = await vpnService.getStatus(user);

  switch (status) {
    case "blocked":
      await ctx.reply("Ваш доступ к VPN заблокирован.");
      break;
    case "active":
      await ctx.reply("VPN-ключ активен.");
      break;
    case "none":
      await ctx.reply("У вас нет VPN-ключа. Используйте /vpn для получения.");
      break;
  }
}
