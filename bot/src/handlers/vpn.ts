import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { vpnService } from "../services/vpn.service.js";

const VPN_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-INCY-09-07";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildSetupInstructions(subscriptionUrl: string): string {
  return [
    "🔐 <b>МОЖНО VPN</b>",
    "",
    "Твой ключ готов. Эти загадочные буквы и цифры — не шифр от сейфа, а личная ссылка для подключения 😁",
    "",
    "Нажми на неё, скопируй и добавь в INCY:",
    `<pre>${escapeHtml(subscriptionUrl)}</pre>`,
    "",
    "Подробно, с картинками и красными кружочками:",
    `<a href="${VPN_SETUP_GUIDE_URL}">Как подключить МОЖНО VPN в INCY</a>`,
    "",
    "После добавления появятся три страны: Нидерланды, Германия и Латвия. Выбирай любую. Если одна сегодня решила показать характер — переключайся на другую)",
    "",
    "Ключ личный, поэтому никому его не пересылай. Всё, финальный вжух — и можно спокойно идти по своим делам 👌",
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

    await ctx.reply(text, { parse_mode: "HTML" });
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
