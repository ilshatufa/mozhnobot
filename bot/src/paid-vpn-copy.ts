export const PAID_VPN_START_TEXT = [
  "<b>МОЖНО VPN</b>",
  "",
  "Одна личная ссылка — четыре VPN-профиля.",
  "",
  "Здесь можно включить пробный период, оплатить подписку и подключить VPN.",
].join("\n");

export const PAID_VPN_NO_ACCESS_TEXT = [
  "МОЖНО VPN пока не подключён.",
  "",
  "Если тебе уже выдали бесплатный доступ, напиши в поддержку.",
].join("\n");

export const PAID_VPN_BLOCKED_TEXT = "МОЖНО VPN заблокирован. Чтобы узнать причину, напиши в поддержку.";
export const PAID_VPN_BANNED_TEXT = "Бот для тебя недоступен. Чтобы узнать причину, напиши в поддержку.";

const RICH_SPACER = "⠀";

function joinPaidVpnBlocks(blocks: string[]): string {
  return `${blocks.join(`\n${RICH_SPACER}\n`)}\n${RICH_SPACER}`;
}

export const PAID_VPN_STARS_HELP_TEXT = joinPaidVpnBlocks([
  "<b>Как купить Telegram Stars</b>",
  "1. Открой официальный @PremiumBot с синей галочкой.\n2. Нажми «Запустить» и выбери «Купить звёзды».\n3. Укажи количество Stars и оплати покупку.\n4. Вернись сюда и продолжи оплату VPN.",
  "Если кнопки покупки нет, открой @PremiumBot через Telegram Desktop, Telegram Web или приложение для Android с сайта telegram.org.",
  "Не вводи пароль или код от Telegram. Имя официального бота — @PremiumBot.",
]);

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
  trialAvailable?: boolean;
  trialExpiredAt?: Date | null;
  adminConfigurationMissing?: boolean;
}): string {
  const status = input.trialExpiredAt
    ? `<b>Пробный период закончился</b>\n${formatPaidVpnDate(input.trialExpiredAt)}. Списаний не было. Личная ссылка сохранена.`
    : input.expiredAt
      ? `<b>Оплаченный период закончился</b>\n${formatPaidVpnDate(input.expiredAt)}. Личная ссылка сохранена.`
      : "Одна личная ссылка — четыре VPN-профиля.";
  const trial = input.trialAvailable
    ? "<b>7 дней бесплатно</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 1 ГБ на всю неделю\n\nОплата не нужна. После пробного периода списаний не будет."
    : "<b>Что входит в подписку</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ каждые 30 дней";
  const sale = input.salesAvailable
    ? `<b>${input.trialAvailable ? "После пробного периода" : "Подписка"}</b>\n${input.amountStars} ⭐ за 30 дней. Продление включается автоматически, но его можно отключить в боте.`
    : input.adminConfigurationMissing
      ? "Тестовая оплата пока недоступна: добавь ссылку и версию условий в настройки бота."
      : input.trialAvailable
        ? "Оплата пока закрыта. Бесплатный период уже доступен."
        : "Оплата пока закрыта. Если доступ нужен сейчас, напиши в поддержку.";
  const acceptance = input.trialAvailable
    ? "Нажимая «Начать бесплатно», ты принимаешь условия."
    : null;
  return joinPaidVpnBlocks([
    "<b>МОЖНО VPN</b>",
    status,
    trial,
    sale,
    ...(acceptance ? [acceptance] : []),
  ]);
}

export function buildPaidVpnConfirmationText(input: {
  amountStars: number;
  trialActive?: boolean;
}): string {
  return joinPaidVpnBlocks([
    "<b>Подписка на МОЖНО VPN</b>",
    `${input.amountStars} ⭐ спишется сейчас. Затем — столько же каждые 30 дней.`,
    "<b>Что будет доступно</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ каждые 30 дней",
    ...(input.trialActive
      ? ["Оплаченные 30 дней начнутся сразу. Остаток бесплатной недели не перенесётся."]
      : []),
    "Продление можно отключить в боте. Уже оплаченный срок сохранится.",
    "Нажимая «Принять и оплатить», ты принимаешь условия.",
  ]);
}

export function buildPaidVpnTrialActiveText(input: {
  subscriptionUrl: string;
  endsAt: Date;
  whitelistUsedBytes: bigint;
  whitelistLimitBytes: bigint;
}): string {
  const usedMb = Number(input.whitelistUsedBytes / (1024n ** 2n));
  const limitGb = Number(input.whitelistLimitBytes / (1024n ** 3n));
  return joinPaidVpnBlocks([
    "<b>Пробный период работает</b>",
    `До ${formatPaidVpnDate(input.endsAt)}.\nОплата не нужна. Списаний не будет.`,
    `<b>Твои профили</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — ${usedMb} МБ из ${limitGb} ГБ`,
    "<b>Как подключиться</b>\nУстанови INCY или HAPP, затем нажми «Подключить VPN».",
    "Если кнопка не сработает, скопируй ссылку в приложение:",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
  ]);
}

export const PAID_VPN_TRIAL_PROVISIONING_TEXT = joinPaidVpnBlocks([
  "<b>Готовим пробный доступ</b>",
  "Профили ещё создаются. Бесплатные 7 дней начнутся, когда ссылка будет готова.",
  "Проверь доступ через несколько минут.",
]);

export const PAID_VPN_STATUS_ERROR_TEXT = joinPaidVpnBlocks([
  "<b>Не удалось открыть МОЖНО VPN</b>",
  "Попробуй снова через несколько минут. Если экран не откроется, напиши в поддержку.",
]);

export const PAID_VPN_INVOICE_SENT_TEXT = joinPaidVpnBlocks([
  "<b>Счёт отправлен</b>",
  "Нажми кнопку оплаты в отдельном сообщении Telegram.",
  "VPN включится автоматически после подтверждения платежа.",
]);

export function buildPaidVpnActiveText(input: {
  subscriptionUrl: string;
  expiresAt: Date;
  renewalState: "active" | "canceled" | "failed" | "unknown";
}): string {
  const renewalText = input.renewalState === "active"
    ? `Оплачено до ${formatPaidVpnDate(input.expiresAt)}. В этот день подписка продлится автоматически.`
    : input.renewalState === "canceled"
      ? `Оплачено до ${formatPaidVpnDate(input.expiresAt)}. Автопродление отключено.`
      : input.renewalState === "failed"
        ? `Оплачено до ${formatPaidVpnDate(input.expiresAt)}. Последнее автопродление не прошло.`
        : `VPN оплачен до ${formatPaidVpnDate(input.expiresAt)}.`;
  return joinPaidVpnBlocks([
    "<b>МОЖНО VPN работает</b>",
    renewalText,
    "<b>Твои профили</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ, лимит обновляется каждые 30 дней",
    "<b>Как подключиться</b>\nУстанови INCY или HAPP, затем нажми «Подключить VPN».",
    "Если кнопка не сработает, скопируй ссылку в приложение:",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
  ]);
}

export function buildPaidVpnFreeAccessText(input: {
  subscriptionUrl: string;
  paidExpiresAt?: Date | null;
  renewalActive: boolean;
}): string {
  const renewalNotice = input.renewalActive && input.paidExpiresAt
    ? `Важно: у прежней подписки осталось автопродление. Следующее списание — ${formatPaidVpnDate(input.paidExpiresAt)}. Если оно не нужно, отключи продление ниже.`
    : null;
  return joinPaidVpnBlocks([
    "<b>МОЖНО VPN работает</b>",
    "У тебя бесплатный доступ без срока. Платить не нужно.",
    ...(renewalNotice ? [renewalNotice] : []),
    "<b>Твои профили</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ, лимит обновляется каждые 30 дней",
    "<b>Как подключиться</b>\nУстанови INCY или HAPP, затем нажми «Подключить VPN».",
    "Если кнопка не сработает, скопируй ссылку в приложение:",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
  ]);
}

export const PAID_VPN_PROVISIONING_ERROR_TEXT = joinPaidVpnBlocks([
  "<b>Оплата получена</b>",
  "Профили ещё создаются. Повторно платить не нужно.",
  "Проверь доступ через несколько минут. Если ссылка не появится, напиши в поддержку.",
]);

export const PAID_VPN_FREE_PROVISIONING_ERROR_TEXT = joinPaidVpnBlocks([
  "<b>Бесплатный доступ включён</b>",
  "Профили ещё создаются. Проверь доступ через несколько минут.",
  "Если ссылка не появится, напиши в поддержку.",
]);

export function buildPaidVpnPaymentReadyText(expiresAt: Date, renewal: boolean): string {
  return joinPaidVpnBlocks([
    renewal ? "<b>МОЖНО VPN продлён</b>" : "<b>МОЖНО VPN оплачен</b>",
    `VPN работает до ${formatPaidVpnDate(expiresAt)}.`,
    "Личная ссылка и четыре профиля уже готовы. Нажми «Открыть VPN».",
  ]);
}

export function buildPaidVpnCancelConfirmationText(expiresAt: Date): string {
  return joinPaidVpnBlocks([
    "<b>Отключить продление?</b>",
    "Новых списаний не будет.",
    `VPN продолжит работать до ${formatPaidVpnDate(expiresAt)}. Личная ссылка и профили сохранятся.`,
  ]);
}

export function buildPaidVpnTermsText(termsUrl: string): string {
  return termsUrl
    ? "Условия подписки и возвратов — по кнопке ниже."
    : "Условия ещё не опубликованы, поэтому оплата пока недоступна.";
}

export function buildPaidVpnSupportText(username: string): string {
  return joinPaidVpnBlocks([
    "<b>Поддержка МОЖНО VPN</b>",
    `Напиши ${escapeHtml(username)} и укажи:\n• свой Telegram username\n• что именно не работает\n• дату и сумму, если вопрос об оплате`,
  ]);
}

export const PAID_VPN_PENDING_ACCESS_PROGRESS_TEXT = "Подключаю бесплатный доступ…";

export const PAID_VPN_PENDING_ACCESS_READY_TEXT = [
  "Бесплатный доступ к МОЖНО VPN включён.",
  "",
  "Отправь /vpn, чтобы подключить профили.",
].join("\n");

export const PAID_VPN_PENDING_ACCESS_ERROR_TEXT = [
  "Не получилось подключить бесплатный доступ.",
  "",
  "Отправь /start ещё раз через несколько минут.",
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
