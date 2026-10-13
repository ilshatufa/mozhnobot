import assert from "node:assert/strict";
import test from "node:test";
import { extractSearchTerms, searchQuestionGuidance } from "./search-query.js";

test("asks for a real question instead of enqueueing a greeting", () => {
  assert.equal(
    searchQuestionGuidance("Привет!", "web"),
    "Привет! Напишите, что именно нужно найти в интернете.",
  );
  assert.equal(searchQuestionGuidance("Какая сегодня ставка?", "web"), null);
});

test("extracts unique meaningful terms for local club search", () => {
  assert.deepEqual(
    extractSearchTerms("Кто уже проходил через ремонт квартиры и РЕМОНТ?"),
    ["ремонт", "квартиры"],
  );
});
