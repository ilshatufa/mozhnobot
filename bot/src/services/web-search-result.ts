import { ClubSearchRequestStatus, type ClubSearchRequest } from "@prisma/client";

const MAX_WEB_ANSWER_LENGTH = 3_000;
const MAX_SOURCE_TITLE_LENGTH = 180;
const SOURCE_LIMIT = 8;

export type WebSearchSource = {
  title: string;
  url: string;
};

function escapeMarkdown(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&");
}

function formatText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => paragraph.split("\n").map(escapeMarkdown).join("  \n"))
    .join("\n\n");
}

function quote(text: string): string {
  return text.split("\n").map((line) => `> ${escapeMarkdown(line)}`).join("\n");
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replaceAll("(", "%28").replaceAll(")", "%29");
  } catch {
    return null;
  }
}

export function parseWebSearchSources(value: unknown): WebSearchSource[] {
  if (!Array.isArray(value)) return [];
  const result: WebSearchSource[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<WebSearchSource>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const url = typeof candidate.url === "string" ? normalizeUrl(candidate.url.trim()) : null;
    if (!title || !url || url.length > 2_048 || seen.has(url)) continue;
    seen.add(url);
    result.push({ title: [...title].slice(0, MAX_SOURCE_TITLE_LENGTH).join(""), url });
    if (result.length === SOURCE_LIMIT) break;
  }

  return result;
}

function buildScreen(question: string, content: string): string {
  return ["# Ответ из интернета", quote(question), content].join("\n\n");
}

export function buildWebSearchResultRichMarkdown(
  request: Pick<ClubSearchRequest, "status" | "question" | "answer" | "webSources">,
): string {
  if (request.status === ClubSearchRequestStatus.FAILED) {
    return buildScreen(
      request.question,
      formatText("Сейчас веб-поиск недоступен. Попробуйте ещё раз позже."),
    );
  }

  const answer = request.answer?.trim();
  const sources = parseWebSearchSources(request.webSources);
  if (!answer || sources.length === 0) {
    return buildScreen(
      request.question,
      formatText("Веб-поиск не вернул ответа с проверяемыми источниками. Попробуйте уточнить запрос."),
    );
  }

  const sourceList = sources
    .map((source, index) => `${index + 1}. [${escapeMarkdown(source.title)}](${source.url})`)
    .join("\n");

  return buildScreen(
    request.question,
    `${formatText(answer.slice(0, MAX_WEB_ANSWER_LENGTH))}\n\n## Источники из веба\n\n${sourceList}`,
  );
}
