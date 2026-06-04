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
            "Преобразуй сырую транскрибацию устной речи в читаемый письменный текст.",
            "Это НЕ саммари и НЕ конспект: сохрани весь смысл, все факты, детали, нюансы, примеры, цифры, имена, ссылки, последовательность мыслей и позицию автора.",
            "Нельзя сокращать до главного, удалять важные детали, добавлять новые факты, менять выводы автора или перестраивать текст так, будто это аналитическая заметка.",
            "Можно убирать слова-паразиты, междометия, явные повторы, самопоправки, обрывки фраз и мусор распознавания, если это не меняет смысл.",
            "Исправляй очевидные ошибки распознавания, грамматику и пунктуацию, но сохраняй живой разговорный стиль автора.",
            "Разбей текст на короткие смысловые абзацы, чтобы он не шел простыней.",
            "Если в речи есть явное перечисление, оформи его маркированным списком.",
            "Не добавляй заголовки, резюме, блоки 'главное', 'итоги' или комментарии от себя.",
            "Если часть речи неразборчива, оставь пометку [неразборчиво].",
            "Верни только готовый очищенный полный текст.",
          ].join("\n"),
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
