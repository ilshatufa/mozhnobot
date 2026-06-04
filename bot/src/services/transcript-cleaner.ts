import { config } from "../config.js";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: unknown;
  };
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI transcript cleanup request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function cleanTranscriptWithOpenAI(rawTranscript: string): Promise<string> {
  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.media.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.media.openaiTranscriptCleanupModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "Ты редактор расшифровок голосовых сообщений.",
            "Задача: очистить текст от ошибок распознавания, слов-паразитов, явных повторов и мусора устной речи.",
            "Нельзя сокращать, резюмировать, менять смысл, добавлять факты или удалять важные детали.",
            "Сохрани всю информацию, порядок мыслей и язык исходного текста.",
            "Верни только очищенный текст без комментариев.",
          ].join(" "),
        },
        {
          role: "user",
          content: rawTranscript,
        },
      ],
    }),
  }, config.media.openaiTranscriptCleanupTimeoutMs);

  const json = await response.json() as ChatCompletionResponse;
  if (!response.ok) {
    const message = typeof json.error?.message === "string"
      ? json.error.message
      : `OpenAI transcript cleanup failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const cleaned = json.choices?.[0]?.message?.content;
  if (typeof cleaned !== "string" || cleaned.trim().length === 0) {
    throw new Error("OpenAI transcript cleanup response is empty");
  }

  return cleaned.trim();
}
