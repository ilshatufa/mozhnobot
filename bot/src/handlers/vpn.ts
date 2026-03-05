import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { vpnService } from "../services/vpn.service.js";

const VPN_SETUP_INSTRUCTIONS = [
  "<b>Как подключиться</b>",
  "",
  "<b>1) Установите V2Box</b>",
  "• <a href=\"https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690\">iOS (App Store)</a>",
  "• <a href=\"https://play.google.com/store/apps/details?id=dev.hexasoftware.v2box\">Android (Google Play)</a>",
  "",
  "<b>2) Импортируйте ключ в V2Box</b>",
  "2.1 Скопируйте ссылку из блока <b>Ваш ключ</b> целиком",
  "2.2 Откройте приложение V2Box",
  "2.3 Внизу нажмите <b>Конфигурации</b>",
  "2.4 Сверху нажмите кнопку <b>+</b>",
  "2.5 Выберите <b>Импортировать v2ray URI из буфера обмена</b>",
  "",
  "<b>3) Подключитесь</b>",
  "• Выберите импортированный профиль",
  "• Нажмите Connect",
  "",
  "<b>Если не подключается</b>",
  "• Обновите подписку в приложении",
  "• Проверьте автонастройку даты и времени на устройстве",
  "• Попробуйте другую сеть (Wi-Fi/мобильный интернет)",
].join("\n");

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

  try {
    const result = await vpnService.getOrCreateKey(user);
    const { key, alreadyExisted } = result;

    let text: string;
    if (alreadyExisted) {
      text = `У вас уже есть активный ключ.\n\nСрок действия до: ${formatDate(key.expiresAt)}\nОсталось: ${remainingTime(key.expiresAt)}`;
    } else {
      text = `VPN-ключ создан!\n\nСрок действия до: ${formatDate(key.expiresAt)}`;
    }

    text += `\n\n<b>Ваш ключ (нажмите, чтобы скопировать)</b>:\n<pre>${escapeHtml(key.subscriptionUrl)}</pre>`;
    text += `\n\n${VPN_SETUP_INSTRUCTIONS}`;

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
      await ctx.reply(
        `VPN-ключ активен.\n\nСрок действия до: ${formatDate(key!.expiresAt)}\nОсталось: ${remainingTime(key!.expiresAt)}`
      );
      break;
    case "expired":
      await ctx.reply(
        `Ваш VPN-ключ истёк ${formatDate(key!.expiresAt)}.\nИспользуйте /vpn для получения нового.`
      );
      break;
    case "none":
      await ctx.reply("У вас нет VPN-ключа. Используйте /vpn для получения.");
      break;
  }
}
