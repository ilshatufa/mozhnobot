import assert from "node:assert/strict";
import test from "node:test";
import { ClubSearchRequestStatus } from "@prisma/client";
import { buildSearchResultRichMarkdown } from "./club-search-result.js";

test("renders rich previews before source links in requested order", () => {
  const result = buildSearchResultRichMarkdown(
    {
      status: ClubSearchRequestStatus.COMPLETED,
      question: "Кто уже делал ремонт <в новостройке>?",
      answer: [
        "Точно проходили:",
        "• Участник описал завершённый ремонт.",
        "Связаны с темой:",
        "• Другой участник работает с ремонтами.",
      ].join("\n\n"),
      sourceMessageIds: [20, 10, 20],
    },
    [
      { telegramMessageId: 10, text: "Второе сообщение", caption: null },
      { telegramMessageId: 20, text: "Первое <сообщение> & детали", caption: null },
    ],
    "-100123456",
  );

  assert.match(result, /^# Ответ из истории клуба/);
  assert.match(result, /> Кто уже делал ремонт &lt;в новостройке&gt;\?/);
  assert.match(result, /## Точно проходили/);
  assert.match(result, /<details><summary>Связаны с темой<\/summary>/);
  assert.match(result, /<\/details>/);
  assert.match(result, /## Сообщения из клуба/);
  assert.match(result, /> Первое &lt;сообщение&gt; &amp; детали/);
  assert.equal(result.match(/t\.me\/c\/123456\/20/g)?.length, 1);
  assert.ok(result.indexOf("Первое &lt;сообщение&gt;") < result.indexOf("t.me/c/123456/20"));
  assert.ok(result.indexOf("t.me/c/123456/20") < result.indexOf("Второе сообщение"));
});

test("keeps a source link when the indexed message has no text preview", () => {
  const result = buildSearchResultRichMarkdown(
    {
      status: ClubSearchRequestStatus.COMPLETED,
      question: "Что обсуждали?",
      answer: "Ответ",
      sourceMessageIds: [42],
    },
    [],
    "-100123456",
  );

  assert.equal(result.match(/^> /gm)?.length, 1);
  assert.match(result, /\[Открыть сообщение 1\]\(https:\/\/t\.me\/c\/123456\/42\)/);
});

test("renders empty results as a rich screen with the original question", () => {
  const result = buildSearchResultRichMarkdown(
    {
      status: ClubSearchRequestStatus.COMPLETED,
      question: "Кто сталкивался?",
      answer: null,
      sourceMessageIds: [],
    },
    [],
    "-100123456",
  );

  assert.match(result, /^# Ответ из истории клуба/);
  assert.match(result, /> Кто сталкивался\?/);
  assert.match(result, /По истории клуба не нашлось достаточно данных/);
});
