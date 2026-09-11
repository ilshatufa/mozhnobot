import assert from "node:assert/strict";
import test from "node:test";
import { type Context } from "telegraf";
import { isClubGroupSearchCommand } from "./auth.js";

function groupContext(chatId: number, text: string): Context {
  return {
    updateType: "message",
    chat: { id: chatId, type: "supergroup", title: "Клуб" },
    message: { text },
  } as unknown as Context;
}

test("allows explicit search commands only in the configured club group", () => {
  const clubGroupId = "-100123";

  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/ask Кто сталкивался?"), clubGroupId), true);
  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/web@MozhnoClub_Bot Что нового?"), clubGroupId), true);
  assert.equal(isClubGroupSearchCommand(groupContext(-100999, "/ask Кто сталкивался?"), clubGroupId), false);
});

test("does not allow ordinary messages or other commands in the club group", () => {
  const clubGroupId = "-100123";

  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "Кто сталкивался?"), clubGroupId), false);
  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/vpn"), clubGroupId), false);
  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/asking вопрос"), clubGroupId), false);
});
