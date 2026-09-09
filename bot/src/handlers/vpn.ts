import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { vpnService } from "../services/vpn.service.js";

const INCY_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-INCY-09-07";
const HAPP_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-HAPP-09-07";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildSetupInstructions(subscriptionUrl: string): string {
  return [
    "🔐 <b>МОЖНО VPN</b>",
    "",
    "Твой ключ готов. Эти загадочные буквы и цифры — не шифр от сейфа, а личная ссылка для подключения 😁",
    "",
    "<b>1. Твой ключ</b>",
    "Скопируй ссылку и добавь её в приложение:",
    `<pre>${escapeHtml(subscriptionUrl)}</pre>`,
    "",
    "<b>2. Выбери приложение</b>",
    "Выбирай, что удобнее: INCY или HAPP. Оба приложения работают с одним ключом.",
    "",
    "Если хочется по шагам:",
    `• <a href="${INCY_SETUP_GUIDE_URL}">INCY — инструкция с картинками</a>`,
    `• <a href="${HAPP_SETUP_GUIDE_URL}">HAPP — инструкция с картинками</a>`,
    "",
    "<b>3. Подключись</b>",
    "После добавления появится список доступных серверов. Выбирай любой. Если один сегодня решил покапризничать — просто переключись на другой)",
    "",
    "Ссылку достаточно добавить один раз — дальше приложение само будет обновлять список серверов. Вот и вся магия 😁",
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

    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
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
