import assert from "node:assert/strict";
import test from "node:test";
import { ClubQuestionAnswerService, groundedClubAnswer, type ClubSearchEvidence } from "./club-question-answer.service.js";

const introduction: ClubSearchEvidence = {
  telegramMessageId: 42, author: "Марина", postedAt: new Date("2026-10-12T12:00:00Z"),
  replyToTelegramMessageId: null, text: "Меня зовут Марина, живу в Твери. Работаю дизайнером.",
};
const fact = { text: "Марина написала 12 октября, что живёт в Твери.", evidence: [{ messageId: 42, quote: "Меня зовут Марина, живу в Твери." }] };
const options = { apiKey: "test", baseUrl: "https://model.example/v1", model: "test-model", timeoutMs: 1000 };
function response(value: unknown): Response {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
}

test("answers the question with only cited evidence, preserving semantic search phrases", async () => {
  const requests: Array<Record<string, any>> = [];
  const service = new ClubQuestionAnswerService(options, {
    async search(chatId, queries, limit) {
      assert.equal(chatId, -100123n);
      assert.deepEqual(queries, ["Тверь", "тверичанка"]);
      assert.equal(limit, 24);
      return [introduction, { ...introduction, telegramMessageId: 7, text: "Правила участия в клубе." }];
    },
  }, async (_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return requests.length === 1 ? response({ queries: ["Тверь", "тверичанка", "Тверь"] }) : response({ facts: [fact] });
  });
  const result = await service.search(-100123n, "Есть кто из участников из Твери?");
  assert.deepEqual(result, { answer: fact.text + " [1]", sourceMessageIds: [42] });
  assert.equal(requests[0].messages[1].content.includes(introduction.text), false);
  assert.equal(requests[1].tools, undefined);
  const sent = JSON.parse(requests[1].messages[1].content);
  assert.equal(sent.messages[0].author, "Марина");
  assert.equal(sent.messages[0].fullText, undefined);
});

test("does not turn an empty retrieval into a fabricated answer or a keyword list", async () => {
  let calls = 0;
  const service = new ClubQuestionAnswerService(options, { async search() { return []; } }, async () => {
    calls += 1;
    return response({ queries: ["Тверь"] });
  });
  assert.deepEqual(await service.search(1n, "Кто из Твери?"), { answer: null, sourceMessageIds: [] });
  assert.equal(calls, 1);
  assert.deepEqual(groundedClubAnswer({ facts: [] }, [introduction]), { answer: null, sourceMessageIds: [] });
});

test("rejects invented source IDs, fabricated quotes and model-generated links", () => {
  assert.throws(() => groundedClubAnswer({ facts: [{ ...fact, evidence: [{ messageId: 999, quote: introduction.text }] }] }, [introduction]), /unverified evidence/);
  assert.throws(() => groundedClubAnswer({ facts: [{ ...fact, evidence: [{ messageId: 42, quote: "Я живу в Москве" }] }] }, [introduction]), /unverified evidence/);
  assert.throws(() => groundedClubAnswer({ facts: [{ ...fact, text: "Марина https://example.com" }] }, [introduction]), /unverified reference/);
  assert.throws(() => groundedClubAnswer({ facts: [{ ...fact, text: "Марина [8]" }] }, [introduction]), /unverified reference/);
});

test("verifies quotes against original text, not invented joins of excerpts", () => {
  const excerpt = { ...introduction, fullText: introduction.text, text: "Марина ... в Твери" };
  assert.throws(() => groundedClubAnswer({ facts: [{ ...fact, evidence: [{ messageId: 42, quote: excerpt.text }] }] }, [excerpt]), /unverified evidence/);
});

test("keeps each claim tied to its own sources and deduplicates shared sources", () => {
  const second = { ...introduction, telegramMessageId: 43, text: "Я тоже живу в Твери.", replyToTelegramMessageId: 42 };
  const result = groundedClubAnswer({ facts: [fact, { text: "В ответе тоже упомянуто проживание в Твери.", evidence: [{ messageId: 43, quote: second.text }, fact.evidence[0]] }] }, [introduction, second]);
  assert.deepEqual(result.sourceMessageIds, [42, 43]);
  assert.match(result.answer!, /\[2\] \[1\]$/);
});

test("a short reply cannot establish a fact without its parent question", () => {
  const parent = { ...introduction, text: "Кто живёт в Твери?" };
  const reply = { ...introduction, telegramMessageId: 43, text: "Я", replyToTelegramMessageId: 42 };
  const replyFact = { text: "Марина ответила, что живёт в Твери.", evidence: [{ messageId: 43, quote: "Я" }] };
  assert.throws(() => groundedClubAnswer({ facts: [replyFact] }, [parent, reply]), /context of a short reply/);
  assert.deepEqual(groundedClubAnswer({ facts: [{ ...replyFact, evidence: [...replyFact.evidence, { messageId: 42, quote: parent.text }] }] }, [parent, reply]).sourceMessageIds, [43, 42]);
});

test("provider errors stop the request instead of silently using keyword search", async () => {
  let searched = false;
  const service = new ClubQuestionAnswerService(options, { async search() { searched = true; return []; } }, async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(service.search(1n, "Кто из Твери?"), /HTTP 503/);
  assert.equal(searched, false);
});

test("truncated and malformed AI output cannot become an answer", async () => {
  for (const body of [Response.json({ choices: [{ finish_reason: "length", message: { content: '{"queries":["Тверь"]}' } }] }), response({ queries: [] }), new Response("private invalid payload")]) {
    const service = new ClubQuestionAnswerService(options, { async search() { throw new Error("must not run"); } }, async () => body);
    await assert.rejects(service.search(1n, "Кто из Твери?"), (error: Error) => !error.message.includes("private invalid payload"));
  }
});
