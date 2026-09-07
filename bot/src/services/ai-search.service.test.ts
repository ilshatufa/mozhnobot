import assert from "node:assert/strict";
import test from "node:test";
import { type ClubMessageSearchRepositoryLike } from "../repositories/club-message-search.repository.js";
import { type AiSearchCandidate } from "./ai-search-core.js";
import { ClubAiSearchService } from "./ai-search.service.js";

const candidate: AiSearchCandidate = {
  id: 42,
  telegramMessageId: 700,
  authorName: "@anna",
  content: "Я принимала квартиру вместе с независимым приёмщиком.",
  postedAt: new Date("2026-08-09T12:00:00.000Z"),
};

function repositoryWith(results: AiSearchCandidate[]): ClubMessageSearchRepositoryLike {
  return {
    async search() {
      return results;
    },
  };
}

test("search returns no_matches without calling OpenAI", async () => {
  let fetchCalled = false;
  const service = new ClubAiSearchService(
    repositoryWith([]),
    { apiKey: "test", model: "gpt-4o-mini", timeoutMs: 1000, maxResults: 30 },
    async () => {
      fetchCalled = true;
      throw new Error("unexpected fetch");
    },
  );

  assert.deepEqual(await service.search("ремонт квартиры", -1004021375237n), {
    kind: "no_matches",
  });
  assert.equal(fetchCalled, false);
});

test("search requests a strict schema and returns a grounded answer", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const service = new ClubAiSearchService(
    repositoryWith([candidate]),
    { apiKey: "test", model: "gpt-4o-mini", timeoutMs: 1000, maxResults: 30 },
    async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              found: true,
              answer: "@anna проходила приёмку с независимым специалистом.",
              sourceIds: [42],
            }),
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  const result = await service.search("кто принимал квартиру", -1004021375237n);

  assert.equal(result.kind, "answer");
  if (result.kind === "answer") assert.deepEqual(result.answer.sourceIds, [42]);
  assert.deepEqual(
    (requestBody?.response_format as { json_schema?: { strict?: boolean } }).json_schema?.strict,
    true,
  );
});

test("search rejects a hallucinated source id", async () => {
  const service = new ClubAiSearchService(
    repositoryWith([candidate]),
    { apiKey: "test", model: "gpt-4o-mini", timeoutMs: 1000, maxResults: 30 },
    async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ found: true, answer: "Ответ", sourceIds: [999] }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );

  await assert.rejects(
    () => service.search("ремонт квартиры", -1004021375237n),
    /unknown source/,
  );
});
