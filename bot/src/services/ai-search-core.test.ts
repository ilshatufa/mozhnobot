import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTelegramMessageUrl,
  extractSearchTerms,
  formatSearchAnswer,
  type AiSearchCandidate,
  validateModelAnswer,
} from "./ai-search-core.js";

const candidates: AiSearchCandidate[] = [
  {
    id: 17,
    telegramMessageId: 321,
    authorName: "<Анна>",
    content: "Делала ремонт с приёмщиком.",
    postedAt: new Date("2026-08-09T12:00:00.000Z"),
  },
];

test("extractSearchTerms keeps meaningful unique words", () => {
  assert.deepEqual(
    extractSearchTerms("Кто здесь уже проходил через ремонт квартиры и РЕМОНТ?"),
    ["ремонт", "квартиры"],
  );
});

test("extractSearchTerms returns no terms for a context-free question", () => {
  assert.deepEqual(extractSearchTerms("Кто здесь проходил через такое?"), []);
});

test("validateModelAnswer rejects a source outside the retrieved candidates", () => {
  assert.throws(
    () => validateModelAnswer({ found: true, answer: "Ответ", sourceIds: [99] }, candidates),
    /unknown source/,
  );
});

test("formatSearchAnswer escapes text and builds links itself", () => {
  const answer = validateModelAnswer(
    { found: true, answer: "Анна советует <приёмщика>.", sourceIds: [17] },
    candidates,
  );
  const formatted = formatSearchAnswer(answer, candidates, -1004021375237n);

  assert.match(formatted, /Анна советует &lt;приёмщика&gt;\./);
  assert.match(formatted, /&lt;Анна&gt;/);
  assert.match(formatted, /https:\/\/t\.me\/c\/4021375237\/321/);
});

test("buildTelegramMessageUrl refuses unsupported chat identifiers", () => {
  assert.throws(() => buildTelegramMessageUrl(4021375237n, 321), /Cannot build/);
});
