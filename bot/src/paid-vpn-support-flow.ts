export const VPN_SUPPORT_ACTION = "vpn_support";
export const VPN_SUPPORT_REPLY_ACTION_PREFIX = "vpn_support_reply:";

export const VPN_SUPPORT_USER_PROMPT_HEADING = "Поддержка МОЖНО VPN";
export const VPN_SUPPORT_ADMIN_PROMPT_HEADING = "Ответ пользователю";

export function buildVpnSupportReplyAction(telegramId: bigint | number): string {
  return `${VPN_SUPPORT_REPLY_ACTION_PREFIX}${telegramId.toString()}`;
}

export function parseVpnSupportReplyAction(data: string | undefined): number | null {
  if (!data?.startsWith(VPN_SUPPORT_REPLY_ACTION_PREFIX)) return null;
  const raw = data.slice(VPN_SUPPORT_REPLY_ACTION_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  const telegramId = Number(raw);
  return Number.isSafeInteger(telegramId) && telegramId > 0 ? telegramId : null;
}

export function isVpnSupportUserPromptReply(replyText: string | undefined): boolean {
  return replyText?.startsWith(`${VPN_SUPPORT_USER_PROMPT_HEADING}\n`) === true;
}

export function parseVpnSupportAdminPromptTarget(replyText: string | undefined): number | null {
  if (!replyText?.startsWith(`${VPN_SUPPORT_ADMIN_PROMPT_HEADING}\n`)) return null;
  const match = replyText.match(/^Ответ пользователю\nTelegram ID: (\d+)(?:\n|$)/);
  if (!match) return null;
  const telegramId = Number(match[1]);
  return Number.isSafeInteger(telegramId) && telegramId > 0 ? telegramId : null;
}
