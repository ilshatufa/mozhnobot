import assert from "node:assert/strict";
import test from "node:test";
import { ClubSearchRequestStatus } from "@prisma/client";
import { buildSearchResultText } from "./club-search-result.js";

test("renders rich previews before source links in requested order", () => {
  const result = buildSearchResultText(
    {
      status: ClubSearchRequestStatus.COMPLETED,
      answer: "Точно проходили:\n\n• Участник описал завершённый ремонт.",
      sourceMessageIds: [20, 10, 20],
    },
    [
      { telegramMessageId: 10, text: "Второе сообщение", caption: null },
      { telegramMessageId: 20, text: "Первое <сообщение> & детали", caption: null },
    ],
    "-100123456",
  );

  assert.match(result, /<b>Точно проходили<\/b>/);
  assert.match(result, /<b>Сообщения из клуба<\/b>/);
  assert.match(result, /<blockquote expandable>Первое &lt;сообщение&gt; &amp; детали<\/blockquote>/);
  assert.equal(result.match(/t\.me\/c\/123456\/20/g)?.length, 1);
  assert.ok(result.indexOf("Первое &lt;сообщение&gt;") < result.indexOf("t.me/c/123456/20"));
  assert.ok(result.indexOf("t.me/c/123456/20") < result.indexOf("Второе сообщение"));
});

test("keeps a source link when the indexed message has no text preview", () => {
  const result = buildSearchResultText(
    {
      status: ClubSearchRequestStatus.COMPLETED,
      answer: "Ответ",
      sourceMessageIds: [42],
    },
    [],
    "-100123456",
  );

  assert.doesNotMatch(result, /<blockquote/);
  assert.match(result, /<a href="https:\/\/t\.me\/c\/123456\/42">Открыть сообщение 1<\/a>/);
});
