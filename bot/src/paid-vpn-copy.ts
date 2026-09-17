export const PAID_VPN_START_TEXT = [
  "<b>МОЖНО VPN</b>",
  "",
  "Сервис для безопасного и стабильного доступа к интернету.",
  "",
  "Здесь можно оплатить подписку, получить личную ссылку и проверить доступ.",
].join("\n");

export const PAID_VPN_NO_ACCESS_TEXT = [
  "Доступ к МОЖНО VPN пока не подключён.",
  "",
  "Если тебе уже выдали доступ, напиши администратору.",
].join("\n");

export const PAID_VPN_BLOCKED_TEXT = "Доступ к МОЖНО VPN заблокирован. Напиши администратору.";
export const PAID_VPN_BANNED_TEXT = "Доступ к боту заблокирован. Напиши администратору.";
export const PAID_VPN_PROGRESS_TEXT = "Проверяю подписку и доступ…";

const RICH_SPACER = "⠀";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatPaidVpnDate(value: Date): string {
  const formatted = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(value);
  return `${formatted} мск`;
}

export function buildPaidVpnOfferText(input: {
  amountStars: number;
  expiredAt?: Date | null;
  salesAvailable: boolean;
  adminConfigurationMissing?: boolean;
}): string {
  const intro = input.expiredAt
    ? `Предыдущий оплаченный период закончился ${formatPaidVpnDate(input.expiredAt)}. Личная ссылка и профили сохранены.`
    : "Одна постоянная ссылка открывает четыре VPN-профиля: Нидерланды, Германия, Латвия и режим для белых списков.";
  const sale = input.salesAvailable
    ? `${input.amountStars} ⭐ за 30 дней. Подписка продлевается автоматически — отключить продление можно в этом боте.`
    : input.adminConfigurationMissing
      ? "Перед тестовой оплатой нужно опубликовать условия и указать их версию в настройках бота."
      : "Продажи пока не открыты. Если доступ нужен сейчас, напиши в поддержку.";
  return [
    "<b>МОЖНО VPN</b>",
    RICH_SPACER,
    intro,
    RICH_SPACER,
    sale,
    RICH_SPACER,
  ].join("\n\n");
}

export function buildPaidVpnConfirmationText(input: {
  amountStars: number;
}): string {
  return [
    "<b>Подтверждение подписки</b>",
    RICH_SPACER,
    `${input.amountStars} ⭐ спишутся сейчас, затем каждые 30 дней. VPN включится только после подтверждения оплаты Telegram.`,
    RICH_SPACER,
    "Нажимая «Принять и оплатить», ты принимаешь действующие условия. Продление можно отключить в боте, оплаченный срок при этом сохранится.",
    RICH_SPACER,
  ].join("\n\n");
}

export const PAID_VPN_INVOICE_SENT_TEXT = [
  "<b>Счёт отправлен</b>",
  RICH_SPACER,
  "Заверши оплату в сообщении Telegram со счётом. Доступ появится только после подтверждения платежа.",
  RICH_SPACER,
].join("\n\n");

export function buildPaidVpnActiveText(input: {
  subscriptionUrl: string;
  expiresAt: Date;
  renewalState: "active" | "canceled" | "failed" | "unknown";
}): string {
  const renewalText = input.renewalState === "active"
    ? `Следующее списание — ${formatPaidVpnDate(input.expiresAt)}.`
    : input.renewalState === "canceled"
      ? `Автопродление отключено. VPN работает до ${formatPaidVpnDate(input.expiresAt)}.`
      : input.renewalState === "failed"
        ? `Автопродление не прошло. VPN работает до ${formatPaidVpnDate(input.expiresAt)}.`
        : `VPN оплачен до ${formatPaidVpnDate(input.expiresAt)}.`;
  return [
    "<b>МОЖНО VPN подключён</b>",
    RICH_SPACER,
    renewalText,
    RICH_SPACER,
    "Личная ссылка для INCY или HAPP:",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
    RICH_SPACER,
  ].join("\n\n");
}

export function buildPaidVpnFreeAccessText(input: {
  subscriptionUrl: string;
  paidExpiresAt?: Date | null;
  renewalActive: boolean;
}): string {
  const renewalNotice = input.renewalActive && input.paidExpiresAt
    ? [
        RICH_SPACER,
        `У ранее оформленной подписки включено автопродление. Следующее списание — ${formatPaidVpnDate(input.paidExpiresAt)}. Если оно больше не нужно, отключи продление ниже.`,
      ]
    : [];
  return [
    "<b>МОЖНО VPN подключён</b>",
    RICH_SPACER,
    "Администратор предоставил бесплатный доступ без ограничения срока. Оплачивать подписку не нужно.",
    ...renewalNotice,
    RICH_SPACER,
    "Личная ссылка для INCY или HAPP:",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
    RICH_SPACER,
  ].join("\n\n");
}

export const PAID_VPN_PROVISIONING_ERROR_TEXT = [
  "<b>Оплата получена</b>",
  RICH_SPACER,
  "Доступ пока настраивается — повторно платить не нужно. Проверь ещё раз через несколько минут или напиши в поддержку.",
  RICH_SPACER,
].join("\n\n");

export const PAID_VPN_FREE_PROVISIONING_ERROR_TEXT = [
  "<b>Доступ предоставлен</b>",
  RICH_SPACER,
  "Профили пока настраиваются. Проверь ещё раз через несколько минут или напиши в поддержку.",
  RICH_SPACER,
].join("\n\n");

export function buildPaidVpnPaymentReadyText(expiresAt: Date, renewal: boolean): string {
  return [
    renewal ? "<b>МОЖНО VPN продлён</b>" : "<b>Оплата получена</b>",
    RICH_SPACER,
    `Доступ работает до ${formatPaidVpnDate(expiresAt)}. Личная ссылка и четыре профиля готовы в разделе /vpn.`,
    RICH_SPACER,
  ].join("\n\n");
}

export function buildPaidVpnCancelConfirmationText(expiresAt: Date): string {
  return [
    "<b>Отключить автопродление?</b>",
    RICH_SPACER,
    "Новых списаний не будет.",
    `VPN продолжит работать до ${formatPaidVpnDate(expiresAt)}. Личная ссылка, профили и история оплаты сохранятся.`,
    RICH_SPACER,
  ].join("\n\n");
}

export function buildPaidVpnTermsText(termsUrl: string): string {
  return termsUrl
    ? "Условия продажи и использования МОЖНО VPN доступны по кнопке ниже."
    : "Условия продажи ещё не опубликованы. Оплата пока недоступна.";
}

export function buildPaidVpnSupportText(username: string): string {
  return [
    "<b>Помощь с оплатой и доступом</b>",
    RICH_SPACER,
    `Напиши ${escapeHtml(username)}. Укажи свой Telegram username и кратко опиши, что произошло.`,
  ].join("\n\n");
}

export const PAID_VPN_PENDING_ACCESS_PROGRESS_TEXT = "Подключаю выданный доступ…";

export const PAID_VPN_PENDING_ACCESS_READY_TEXT = [
  "Доступ к МОЖНО VPN подключён.",
  "",
  "Отправь /vpn, чтобы получить инструкцию и личную ссылку.",
].join("\n");

export const PAID_VPN_PENDING_ACCESS_ERROR_TEXT = [
  "Не получилось подключить выданный доступ.",
  "",
  "Отправь /start ещё раз позже.",
].join("\n");

export function buildPendingAccessSavedText(username: string): string {
  return [
    `Разрешение для @${username} сохранено.`,
    "",
    "Когда пользователь впервые отправит /start, бот сразу подключит ему бесплатный доступ. Повторять /add не нужно.",
  ].join("\n");
}

export function buildPaidVpnAccessRemovedText(username: string): string {
  return `Бесплатный доступ для @${username} отключён.`;
}

export function buildPendingAccessRemovedText(username: string): string {
  return `Разрешение для @${username} удалено.`;
}

export function buildNoRemovableAccessText(username: string): string {
  return `У @${username} нет бесплатного доступа или ожидающего разрешения.`;
}

export type UsernameCommandParseResult =
  | { ok: true; username: string }
  | { ok: false };

function parseUsernameCommand(text: string, command: "add" | "remove"): UsernameCommandParseResult {
  const match = text.trim().match(
    new RegExp(`^\\/${command}(?:@\\w+)?\\s+@([A-Za-z0-9_]{5,32})$`, "i"),
  );
  return match ? { ok: true, username: match[1] } : { ok: false };
}

export function parseAddUsername(text: string): UsernameCommandParseResult {
  return parseUsernameCommand(text, "add");
}

export function parseRemoveUsername(text: string): UsernameCommandParseResult {
  return parseUsernameCommand(text, "remove");
}
