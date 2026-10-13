import assert from "node:assert/strict";
import test from "node:test";
import { parseQwenWebSearchResponse } from "./qwen-web-search.service.js";

test("parses a grounded Qwen web answer and deduplicates sources", () => {
  const result = parseQwenWebSearchResponse({
    output: [
      {
        type: "web_search_call",
        action: {
          sources: [
            { title: "Ключевая ставка Банка России", url: "https://cbr.ru/hd_base/keyrate/" },
            { title: "Повтор", url: "https://cbr.ru/hd_base/keyrate/" },
            { url: "https://example.com/no-title" },
            { title: "Опасный", url: "file:///etc/passwd" },
          ],
        },
      },
      {
        type: "message",
        content: [{ type: "output_text", text: "Ключевая ставка указана на сайте ЦБ." }],
      },
    ],
  });

  assert.equal(result.answer, "Ключевая ставка указана на сайте ЦБ.");
  assert.deepEqual(result.sources, [
    { title: "Ключевая ставка Банка России", url: "https://cbr.ru/hd_base/keyrate/" },
  ]);
});

test("rejects an answer without verifiable sources", () => {
  assert.throws(
    () => parseQwenWebSearchResponse({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "Непроверенный ответ" }],
      }],
    }),
    /no verifiable sources/,
  );
});
