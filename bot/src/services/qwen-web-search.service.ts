import { z } from "zod";

export type QwenWebSource = {
  title: string;
  url: string;
};

export type QwenWebSearchResult = {
  answer: string;
  sources: QwenWebSource[];
};

const responseSchema = z.object({
  output: z.array(z.object({
    type: z.string().optional(),
    content: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    }).passthrough()).optional(),
    action: z.object({
      sources: z.array(z.object({
        title: z.string().optional(),
        url: z.string(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
  }).passthrough()),
}).passthrough();

export function parseQwenWebSearchResponse(value: unknown): QwenWebSearchResult {
  const response = responseSchema.parse(value);
  const answer = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text!.trim())
    .filter(Boolean)
    .join("\n\n");

  const sources: QwenWebSource[] = [];
  const seen = new Set<string>();
  for (const source of response.output
    .filter((item) => item.type === "web_search_call")
    .flatMap((item) => item.action?.sources ?? [])) {
    const title = source.title?.trim();
    if (!title) continue;
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || seen.has(url.href)) continue;
    seen.add(url.href);
    sources.push({ title, url: url.href });
    if (sources.length === 8) break;
  }

  if (!answer) throw new Error("Qwen web search returned no answer");
  if (sources.length === 0) throw new Error("Qwen web search returned no verifiable sources");
  return { answer, sources };
}

type QwenWebSearchOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

function currentDateInYekaterinburg(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

export class QwenWebSearchService {
  constructor(private readonly options: QwenWebSearchOptions) {}

  async search(question: string): Promise<QwenWebSearchResult> {
    if (!this.options.apiKey) throw new Error("Qwen API key is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          input: [
            "Ответь на русском языке кратко и по существу.",
            "Используй веб-поиск и опирайся на найденные источники.",
            "Не показывай служебные рассуждения и не выдумывай факты.",
            `Текущая дата в Екатеринбурге: ${currentDateInYekaterinburg()}.`,
            `Вопрос: ${question}`,
          ].join("\n"),
          tools: [{ type: "web_search" }],
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(`Qwen web search returned HTTP ${response.status}`);
      return parseQwenWebSearchResponse(body);
    } finally {
      clearTimeout(timeout);
    }
  }
}
