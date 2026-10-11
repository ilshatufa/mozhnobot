type TelegramApiError = {
  code?: unknown;
  description?: unknown;
  response?: {
    error_code?: unknown;
    description?: unknown;
  };
};

function telegramErrorDetails(error: unknown): { code: number | null; description: string } {
  if (!error || typeof error !== "object") {
    return { code: null, description: "" };
  }

  const telegramError = error as TelegramApiError;
  const code =
    typeof telegramError.response?.error_code === "number"
      ? telegramError.response.error_code
      : typeof telegramError.code === "number"
        ? telegramError.code
        : null;
  const description =
    typeof telegramError.response?.description === "string"
      ? telegramError.response.description
      : typeof telegramError.description === "string"
        ? telegramError.description
        : "";

  return { code, description };
}

export function isBotBlockedError(error: unknown): boolean {
  const { code: errorCode, description } = telegramErrorDetails(error);

  return errorCode === 403 && description.toLowerCase().includes("bot was blocked by the user");
}

export function isVideoForbiddenError(error: unknown): boolean {
  const { code, description } = telegramErrorDetails(error);
  if (code !== 400 && code !== 403) return false;

  const normalized = description.toLowerCase();
  return normalized.includes("voice_messages_forbidden") ||
    normalized.includes("video messages are forbidden") ||
    normalized.includes("videos are forbidden") ||
    normalized.includes("can't send video") ||
    normalized.includes("cannot send video");
}

export function isMessageNotModifiedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const telegramError = error as TelegramApiError;
  const description =
    typeof telegramError.response?.description === "string"
      ? telegramError.response.description
      : typeof telegramError.description === "string"
        ? telegramError.description
        : "";

  return description.toLowerCase().includes("message is not modified");
}
