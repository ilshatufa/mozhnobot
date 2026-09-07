import { z } from "zod";

export type AiSearchCandidate = {
  id: number;
  telegramMessageId: number;
  authorName: string | null;
  content: string;
  postedAt: Date;
};

export const aiSearchModelAnswerSchema = z.object({
  found: z.boolean(),
  answer: z.string().trim().min(1).max(2000),
  sourceIds: z.array(z.number().int().positive()).max(5),
});

export type AiSearchModelAnswer = z.infer<typeof aiSearchModelAnswerSchema>;

export const AI_SEARCH_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    answer: { type: "string" },
    sourceIds: {
      type: "array",
      items: { type: "integer" },
      maxItems: 5,
    },
  },
  required: ["found", "answer", "sourceIds"],
  additionalProperties: false,
} as const;

const SEARCH_STOP_WORDS = new Set([
  "без", "был", "была", "были", "быть", "вам", "вас", "весь", "вот",
  "все", "где", "для", "его", "еще", "ещё", "здесь", "или", "как",
  "когда", "кто", "мне", "может", "мой", "мы", "наш", "она", "они",
  "оно", "под", "при", "про", "проходил", "проходила", "проходили",
  "проходить", "сталкивался", "сталкивалась", "сталкивались", "так", "такое",
  "там", "тебя", "тем",
  "то", "тоже", "уже", "через", "что", "эта", "эти", "это", "этого",
  "этой", "этот", "есть", "если", "клуб", "клубе", "история", "истории",
]);

export function extractSearchTerms(question: string): string[] {
  const words = question
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .match(/[\p{L}\p{N}]+/gu) ?? [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    if (word.length < 3 || SEARCH_STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length === 10) break;
  }

  return result;
}

export function validateModelAnswer(
  value: unknown,
  candidates: readonly AiSearchCandidate[],
): AiSearchModelAnswer {
  const answer = aiSearchModelAnswerSchema.parse(value);
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const uniqueSourceIds = [...new Set(answer.sourceIds)];

  if (answer.found && uniqueSourceIds.length === 0) {
    throw new Error("AI search answer has no sources");
  }
  if (!answer.found && uniqueSourceIds.length > 0) {
    throw new Error("AI search empty answer unexpectedly has sources");
  }
  if (uniqueSourceIds.some((id) => !candidateIds.has(id))) {
    throw new Error("AI search answer references an unknown source");
  }

  return { ...answer, sourceIds: uniqueSourceIds };
}

export function buildTelegramMessageUrl(chatTelegramId: bigint, messageId: number): string {
  const rawChatId = chatTelegramId.toString();
  if (!rawChatId.startsWith("-100") || !Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("Cannot build a Telegram message link for this chat");
  }

  return `https://t.me/c/${rawChatId.slice(4)}/${messageId}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSourceDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export function formatSearchAnswer(
  answer: AiSearchModelAnswer,
  candidates: readonly AiSearchCandidate[],
  chatTelegramId: bigint,
): string {
  if (!answer.found) {
    return [
      "<b>По истории клуба</b>",
      "",
      escapeHtml(answer.answer),
      "",
      "Попробуйте добавить тему, имя или конкретный пример.",
    ].join("\n");
  }

  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const sourceLines = answer.sourceIds.map((sourceId, index) => {
    const candidate = candidatesById.get(sourceId);
    if (!candidate) throw new Error("AI search source disappeared while formatting");

    const label = [candidate.authorName, formatSourceDate(candidate.postedAt)]
      .filter((item): item is string => Boolean(item))
      .map(escapeHtml)
      .join(", ");
    const url = buildTelegramMessageUrl(chatTelegramId, candidate.telegramMessageId);
    return `${index + 1}. ${label} — <a href="${url}">открыть сообщение</a>`;
  });

  return [
    "<b>По истории клуба</b>",
    "",
    escapeHtml(answer.answer),
    "",
    "<b>Источники</b>",
    ...sourceLines,
  ].join("\n");
}
