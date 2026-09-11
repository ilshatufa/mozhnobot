import assert from "node:assert/strict";
import test from "node:test";
import { ClubSearchRequestStatus } from "@prisma/client";
import { buildWebSearchResultRichMarkdown, parseWebSearchSources } from "./web-search-result.js";

test("renders a web answer with validated sources", () => {
  const result = buildWebSearchResultRichMarkdown({
    status: ClubSearchRequestStatus.COMPLETED,
    question: "Какие сейчас ставки <по вкладам>?",
    answer: "Ставки зависят от срока.\n\nСравните условия нескольких банков.",
    webSources: [
      { title: "Банк России: ставки & статистика", url: "https://cbr.ru/statistics/" },
      { title: "Повтор", url: "https://cbr.ru/statistics/" },
    ],
  });

  assert.match(result, /^# Ответ из интернета/);
  assert.match(result, /> Какие сейчас ставки &lt;по вкладам&gt;\?/);
  assert.match(result, /## Источники из веба/);
  assert.match(result, /\[Банк России: ставки &amp; статистика\]\(https:\/\/cbr\.ru\/statistics\/\)/);
  assert.equal(result.match(/https:\/\/cbr\.ru\/statistics\//g)?.length, 1);
});

test("rejects non-web and malformed source URLs", () => {
  assert.deepEqual(parseWebSearchSources([
    { title: "Команда", url: "file:///etc/passwd" },
    { title: "Скрипт", url: "javascript:alert(1)" },
    { title: "Ошибка", url: "not a url" },
  ]), []);
});

test("does not show an ungrounded web answer without sources", () => {
  const result = buildWebSearchResultRichMarkdown({
    status: ClubSearchRequestStatus.COMPLETED,
    question: "Что изменилось?",
    answer: "Непроверенный ответ",
    webSources: [],
  });

  assert.doesNotMatch(result, /Непроверенный ответ/);
  assert.match(result, /не вернул ответа с проверяемыми источниками/);
});
