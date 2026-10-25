import assert from "node:assert/strict";
import test from "node:test";
import { searchQuestionGuidance } from "./search-query.js";

test("asks for a real question instead of enqueueing a greeting", () => {
  assert.equal(
    searchQuestionGuidance("Привет!", "web"),
    "Привет! Напишите, что именно нужно найти в интернете.",
  );
  assert.equal(searchQuestionGuidance("Какая сегодня ставка?", "web"), null);
});
