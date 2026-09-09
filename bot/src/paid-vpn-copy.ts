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

export type AddUsernameParseResult =
  | { ok: true; username: string }
  | { ok: false };

export function parseAddUsername(text: string): AddUsernameParseResult {
  const match = text.trim().match(/^\/add(?:@\w+)?\s+@([A-Za-z0-9_]{5,32})$/i);
  return match ? { ok: true, username: match[1] } : { ok: false };
}
