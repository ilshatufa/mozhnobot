import {
  VPN_SUPPORT_ADMIN_PROMPT_HEADING,
  VPN_SUPPORT_USER_PROMPT_HEADING,
} from "./paid-vpn-support-flow.js";

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

export const PAID_VPN_PREMIUM_BOT_URL = "https://t.me/PremiumBot";

function joinPaidVpnBlocks(blocks: string[]): string {
  return `${blocks.join(`\n${RICH_SPACER}\n`)}\n${RICH_SPACER}`;
}

const PAID_VPN_REFERRAL_PROMO = "<b>30 дней за друга</b>\nПригласи нового пользователя — после его первой оплаты тебе добавятся 30 дней.";

export function buildPaidVpnStarsHelpText(input: { amountStars: number }): string {
  return joinPaidVpnBlocks([
    "<b>Покупка звёзд в Telegram</b>",
    "Звёзды можно купить прямо внутри Telegram через официального @PremiumBot.",
    `1. Нажми «Открыть @PremiumBot».\n2. В боте выбери «Купить звёзды» и пополни баланс минимум на ${input.amountStars} ⭐.\n3. Вернись в МОЖНО VPN и оплати подписку звёздами.`,
    "<b>Это два отдельных шага</b>\n@PremiumBot только пополняет баланс. Подписка VPN оплачивается отдельно в МОЖНО VPN.",
    "Не вводи пароль или код от Telegram. Имя официального бота — @PremiumBot.",
  ]);
}

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
  referralAccepted?: boolean;
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
    ? `<b>${input.trialAvailable ? "После пробного периода" : "Подписка"}</b>\n${input.amountStars} ⭐ за 30 дней. Оплата проходит прямо внутри Telegram. Продление включается автоматически, но его можно отключить в боте.`
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
    ...(input.referralAccepted
      ? ["<b>Приглашение принято</b>\nНачни 7 дней бесплатно. Друг получит награду только после твоей первой оплаты."]
      : []),
    status,
    trial,
    sale,
    ...(acceptance ? [acceptance] : []),
    PAID_VPN_REFERRAL_PROMO,
  ]);
}

export function buildPaidVpnConfirmationText(input: {
  amountStars: number;
  trialActive?: boolean;
}): string {
  return joinPaidVpnBlocks([
    "<b>Подписка на МОЖНО VPN</b>",
    `${input.amountStars} ⭐ спишется сейчас. Затем — столько же каждые 30 дней.`,
    `<b>Как оплатить</b>\n• Если звёзды уже есть — нажми «Перейти к оплате».\n• Если звёзд не хватает — нажми «Купить звёзды». Telegram откроет официальный @PremiumBot, где можно пополнить баланс прямо внутри Telegram.`,
    "После покупки звёзд вернись в этот чат и нажми «Перейти к оплате».",
    "<b>Что будет доступно</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ каждые 30 дней",
    ...(input.trialActive
      ? ["Полный доступ включится сразу. Неиспользованный остаток бесплатной недели сохранится и добавится к 30 оплаченным дням."]
      : []),
    "Продление можно отключить в боте. Уже оплаченный срок сохранится.",
    "Нажимая «Перейти к оплате», ты принимаешь условия.",
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
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
    PAID_VPN_REFERRAL_PROMO,
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

export function buildPaidVpnInvoiceReadyText(input: { amountStars: number }): string {
  return joinPaidVpnBlocks([
    "<b>Оплата подписки</b>",
    `Если на балансе есть ${input.amountStars} ⭐, нажми «Оплатить ${input.amountStars} ⭐».`,
    `Если звёзд не хватает, нажми «Купить звёзды». Telegram откроет официальный @PremiumBot для пополнения баланса прямо внутри Telegram. После покупки вернись к этому сообщению и нажми «Оплатить ${input.amountStars} ⭐».`,
    "После оплаты VPN включится автоматически.",
  ]);
}

export const PAID_VPN_INVOICE_ERROR_TEXT = joinPaidVpnBlocks([
  "<b>Не получилось открыть оплату</b>",
  "Попробуй ещё раз. Если оплата по-прежнему не открывается, напиши в поддержку.",
]);

export function buildPaidVpnActiveText(input: {
  subscriptionUrl: string;
  expiresAt: Date;
  nextChargeAt?: Date | null;
  renewalState: "active" | "canceled" | "failed" | "unknown";
}): string {
  const renewalText = input.renewalState === "active"
    ? `Доступ работает до ${formatPaidVpnDate(input.expiresAt)}.${input.nextChargeAt ? ` Следующее списание — ${formatPaidVpnDate(input.nextChargeAt)}.` : " Продление включено."}`
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
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
    PAID_VPN_REFERRAL_PROMO,
  ]);
}

export function buildPaidVpnFreeAccessText(input: {
  subscriptionUrl: string;
  paidExpiresAt?: Date | null;
  nextChargeAt?: Date | null;
  renewalActive: boolean;
}): string {
  const renewalNotice = input.renewalActive
    ? `Важно: у прежней подписки осталось автопродление.${input.nextChargeAt ? ` Следующее списание — ${formatPaidVpnDate(input.nextChargeAt)}.` : ""} Если оно не нужно, отключи продление ниже.`
    : null;
  return joinPaidVpnBlocks([
    "<b>МОЖНО VPN работает</b>",
    "У тебя бесплатный доступ без срока. Платить не нужно.",
    ...(renewalNotice ? [renewalNotice] : []),
    "<b>Твои профили</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ, лимит обновляется каждые 30 дней",
    "<b>Как подключиться</b>\nУстанови INCY или HAPP, затем нажми «Подключить VPN».",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
    PAID_VPN_REFERRAL_PROMO,
  ]);
}

export function buildPaidVpnClubAccessText(input: {
  subscriptionUrl: string;
  renewalActive: boolean;
  nextChargeAt?: Date | null;
}): string {
  const renewalNotice = input.renewalActive
    ? `Важно: платная подписка всё ещё продлевается.${input.nextChargeAt ? ` Следующее списание — ${formatPaidVpnDate(input.nextChargeAt)}.` : ""} Если она не нужна, отключи продление ниже.`
    : null;
  return joinPaidVpnBlocks([
    "<b>МОЖНО VPN работает</b>",
    "Доступ входит в клуб. Отдельно платить за VPN не нужно.",
    ...(renewalNotice ? [renewalNotice] : []),
    "<b>Твои профили</b>\n• Нидерланды, Германия и Латвия — без лимита\n• Белые списки — 10 ГБ, лимит обновляется каждые 30 дней",
    "<b>Как подключиться</b>\nУстанови INCY или HAPP, затем нажми «Подключить VPN».",
    `<pre>${escapeHtml(input.subscriptionUrl)}</pre>`,
    PAID_VPN_REFERRAL_PROMO,
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

export const PAID_VPN_PAYMENT_BANKED_TEXT = joinPaidVpnBlocks([
  "<b>Оплата получена</b>",
  "30 дней сохранены. Они начнутся после бесплатного или клубного доступа.",
  "Повторно платить не нужно.",
]);

export function buildPaidVpnReferralText(input: {
  referralUrl: string;
  invited: number;
  rewarded: number;
}): string {
  const stats = input.invited === 0
    ? "Пока никто не перешёл по твоей ссылке."
    : `Перешли по ссылке: ${input.invited}. Оплатили впервые: ${input.rewarded}.`;
  return joinPaidVpnBlocks([
    "<b>Пригласи друга — получи 30 дней</b>",
    "Друг получит 7 дней бесплатно. После его первой оплаты тебе добавятся 30 дней полного доступа.",
    "Награда действует только за нового пользователя: раньше у него не должно быть пробного периода или оплат МОЖНО VPN.",
    "Если у тебя сейчас бесплатный или клубный доступ, 30 дней сохранятся и начнутся после него.",
    stats,
    "Твоя ссылка:",
    `<pre>${escapeHtml(input.referralUrl)}</pre>`,
  ]);
}

export function buildVpnGiftReceivedText(input: { days: number; pending: boolean }): string {
  return joinPaidVpnBlocks([
    "<b>Тебе подарили МОЖНО VPN</b>",
    input.pending
      ? `${input.days} дней сохранены. Они начнутся после бесплатного или клубного доступа.`
      : `${input.days} дней полного доступа уже добавлены.`,
    "Открой VPN, чтобы увидеть актуальный срок и подключить профили.",
  ]);
}

export function buildVpnReferralRewardText(pending: boolean): string {
  return joinPaidVpnBlocks([
    "<b>Друг оплатил МОЖНО VPN</b>",
    pending
      ? "30 дней награды сохранены. Они начнутся после бесплатного или клубного доступа."
      : "Тебе добавлены 30 дней полного доступа.",
    "Спасибо за рекомендацию.",
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

export const PAID_VPN_SUPPORT_PROMPT_TEXT = joinPaidVpnBlocks([
  `<b>${VPN_SUPPORT_USER_PROMPT_HEADING}</b>`,
  "Опиши проблему одним сообщением. Можно приложить скриншот или документ.",
  "Ответ придёт сюда. Чтобы выйти, отправь /start.",
]);

export const PAID_VPN_SUPPORT_SENT_TEXT = joinPaidVpnBlocks([
  "<b>Сообщение отправлено</b>",
  "Ответ поддержки придёт в этот чат.",
]);

export const PAID_VPN_SUPPORT_UNSUPPORTED_TEXT = joinPaidVpnBlocks([
  "<b>Не получилось отправить это сообщение</b>",
  "Пришли текст, скриншот или документ ответом на сообщение поддержки.",
]);

export const PAID_VPN_SUPPORT_SEND_ERROR_TEXT = joinPaidVpnBlocks([
  "<b>Не получилось отправить сообщение</b>",
  "Попробуй ещё раз через несколько минут.",
]);

export function buildPaidVpnSupportAdminText(input: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  telegramId: bigint;
  accessStatus: string;
}): string {
  const name = [input.firstName, input.lastName].filter(Boolean).join(" ");
  const identity = [
    name ? escapeHtml(name) : null,
    input.username ? `@${escapeHtml(input.username)}` : null,
  ].filter(Boolean).join(" · ") || "Имя не указано";
  return joinPaidVpnBlocks([
    "<b>Новое обращение в МОЖНО VPN</b>",
    identity,
    `Telegram ID: <code>${input.telegramId.toString()}</code>`,
    `Доступ: ${escapeHtml(input.accessStatus)}`,
  ]);
}

export function buildPaidVpnSupportAdminReplyPrompt(telegramId: number): string {
  return joinPaidVpnBlocks([
    `<b>${VPN_SUPPORT_ADMIN_PROMPT_HEADING}</b>\nTelegram ID: <code>${telegramId}</code>`,
    "Напиши ответ одним сообщением. Можно приложить скриншот или документ.",
    "Чтобы выйти, отправь /start.",
  ]);
}

export const PAID_VPN_SUPPORT_RESPONSE_TEXT = "<b>Ответ поддержки</b>";
export const PAID_VPN_SUPPORT_ADMIN_SENT_TEXT = "Ответ отправлен пользователю.";
export const PAID_VPN_SUPPORT_ADMIN_DELIVERY_ERROR_TEXT = "Не получилось доставить ответ. Возможно, пользователь заблокировал бота.";

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

export type GiftCommandParseResult =
  | { ok: true; username: string; days: number }
  | { ok: false };

export function parseGiftCommand(text: string): GiftCommandParseResult {
  const match = text.trim().match(
    /^\/gift(?:@\w+)?\s+@([A-Za-z0-9_]{5,32})\s+(\d{1,4})$/i,
  );
  if (!match) return { ok: false };
  const days = Number(match[2]);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false };
  return { ok: true, username: match[1], days };
}
