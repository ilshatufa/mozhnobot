import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config.js";
import { type AuthContext } from "../middlewares/auth.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";
import { contentReviewActionHandler } from "./content-review.js";

function approvalContext() {
  const calls = {
    answers: [] as Array<[string, unknown]>,
    copies: [] as unknown[][],
    markups: [] as unknown[],
    replies: [] as Array<[string, unknown]>,
  };
  const ctx = {
    update: { update_id: 9001 },
    from: { id: 301474421 },
    callbackQuery: {
      data: "review:skripko-budget-v1:approve",
      message: {
        message_id: 4135,
        chat: { id: 301474421, type: "private" },
      },
    },
    answerCbQuery: async (text: string, extra: unknown) => calls.answers.push([text, extra]),
    editMessageReplyMarkup: async (markup: unknown) => calls.markups.push(markup),
    reply: async (text: string, extra: unknown) => calls.replies.push([text, extra]),
    telegram: {
      copyMessage: async (...args: unknown[]) => {
        calls.copies.push(args);
        return { message_id: 777 };
      },
    },
  } as unknown as AuthContext;
  return { calls, ctx };
}

test("approval copies the reviewed Rich Message to the worldview topic exactly once", async (t) => {
  const originalFind = clubEventRepository.findByDedupeKey;
  const originalCreate = clubEventRepository.createIfNotExists;
  const events: Array<{ dedupeKey: string; eventType: string }> = [];
  clubEventRepository.findByDedupeKey = async () => null;
  clubEventRepository.createIfNotExists = async (input) => {
    events.push({ dedupeKey: input.dedupeKey, eventType: input.eventType });
    return { id: events.length } as never;
  };
  t.after(() => {
    clubEventRepository.findByDedupeKey = originalFind;
    clubEventRepository.createIfNotExists = originalCreate;
  });

  const { calls, ctx } = approvalContext();
  await contentReviewActionHandler(ctx);

  assert.deepEqual(calls.copies, [[
    config.clubGroupId,
    301474421,
    4135,
    { message_thread_id: 6542 },
  ]]);
  assert.deepEqual(calls.markups, [{ inline_keyboard: [] }]);
  assert.equal(calls.answers[0]?.[0], "Опубликовано в «Расширяем кругозор».");
  assert.deepEqual(events.map((event) => event.eventType), [
    "content_review_publish_attempted",
    "content_review_published",
  ]);
});

test("an existing publication is not copied again", async (t) => {
  const originalFind = clubEventRepository.findByDedupeKey;
  clubEventRepository.findByDedupeKey = async () => ({ id: 1 }) as never;
  t.after(() => {
    clubEventRepository.findByDedupeKey = originalFind;
  });

  const { calls, ctx } = approvalContext();
  await contentReviewActionHandler(ctx);

  assert.equal(calls.copies.length, 0);
  assert.equal(calls.answers[0]?.[0], "Этот пост уже опубликован.");
});

test("edit never publishes and opens a correction reply", async () => {
  const { calls, ctx } = approvalContext();
  (ctx.callbackQuery as { data: string }).data = "review:skripko-budget-v1:edit";

  await contentReviewActionHandler(ctx);

  assert.equal(calls.copies.length, 0);
  assert.equal(calls.answers[0]?.[0], "Жду правки ответом на сообщение.");
  assert.match(calls.replies[0]?.[0] ?? "", /Что исправить/);
});
