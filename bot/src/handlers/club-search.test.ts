import assert from "node:assert/strict";
import test from "node:test";
import { extractSearchQuestion } from "./club-search.js";

test("extracts questions from separate club and web commands", () => {
  assert.equal(extractSearchQuestion("/ask Кто сталкивался?"), "Кто сталкивался?");
  assert.equal(extractSearchQuestion("/web Что изменилось?", "web"), "Что изменилось?");
  assert.equal(extractSearchQuestion("/web@MozhnoClub_Bot   Где источник?", "web"), "Где источник?");
});
