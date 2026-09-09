export const PAID_VPN_START_TEXT = [
  "<b>МОЖНО VPN</b>",
  "",
  "Сервис для безопасного и стабильного доступа к интернету.",
  "",
  "Чтобы получить инструкцию и личную ссылку, отправь команду /vpn.",
  "",
  "Сейчас доступ подключается администратором. Платная подписка появится позже.",
].join("\n");

export const PAID_VPN_NO_ACCESS_TEXT = [
  "Доступ к МОЖНО VPN пока не подключён.",
  "",
  "Если тебе уже выдали доступ, напиши администратору.",
].join("\n");

export const PAID_VPN_BLOCKED_TEXT = "Доступ к МОЖНО VPN заблокирован. Напиши администратору.";
export const PAID_VPN_BANNED_TEXT = "Доступ к боту заблокирован. Напиши администратору.";

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
