export type SearchQuestionMode = "club" | "web";

const NON_SEARCH_MESSAGES = new Set([
  "hello",
  "hi",
  "здравствуй",
  "здравствуйте",
  "привет",
  "тест",
]);

function normalizeQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function searchQuestionGuidance(
  question: string,
  mode: SearchQuestionMode,
): string | null {
  const normalized = normalizeQuestion(question);
  if (!normalized || NON_SEARCH_MESSAGES.has(normalized)) {
    return mode === "web"
      ? "Привет! Напишите, что именно нужно найти в интернете."
      : "Привет! Напишите, что именно нужно найти в истории клуба.";
  }
  return null;
}

const SEARCH_STOP_WORDS = new Set([
  "без", "был", "была", "были", "быть", "вам", "вас", "весь", "вот",
  "все", "где", "для", "его", "еще", "ещё", "здесь", "или", "как",
  "когда", "кто", "мне", "может", "мой", "мы", "наш", "она", "они",
  "оно", "под", "при", "про", "проходил", "проходила", "проходили",
  "проходить", "сталкивался", "сталкивалась", "сталкивались", "так", "такое",
  "там", "тебя", "тем", "то", "тоже", "уже", "через", "что", "эта",
  "эти", "это", "этого", "этой", "этот", "есть", "если", "клуб",
  "клубе", "история", "истории",
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
