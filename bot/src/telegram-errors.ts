type TelegramApiError = {
  code?: unknown;
  description?: unknown;
  response?: {
    error_code?: unknown;
    description?: unknown;
  };
};

export function isBotBlockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const telegramError = error as TelegramApiError;
  const errorCode =
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

  return errorCode === 403 && description.toLowerCase().includes("bot was blocked by the user");
}
