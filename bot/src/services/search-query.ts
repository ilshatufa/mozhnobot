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
