import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { type Context } from "telegraf";
import {
  type AuthContext,
  isBotInboxSalesCommand,
  isClubGroupSearchCommand,
  salesReportOnly,
} from "./auth.js";

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
  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/search Кто делал ремонт?"), clubGroupId), true);
  assert.equal(isClubGroupSearchCommand(groupContext(-100999, "/ask Кто сталкивался?"), clubGroupId), false);
});

test("does not allow ordinary messages or other commands in the club group", () => {
  const clubGroupId = "-100123";

  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "Кто сталкивался?"), clubGroupId), false);
  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/vpn"), clubGroupId), false);
  assert.equal(isClubGroupSearchCommand(groupContext(-100123, "/asking вопрос"), clubGroupId), false);
});

test("allows the sales report command only in the configured bot inbox group", () => {
  const botInboxGroupId = "-100555";

  assert.equal(isBotInboxSalesCommand(groupContext(-100555, "/sales"), botInboxGroupId), true);
  assert.equal(
    isBotInboxSalesCommand(groupContext(-100555, "/sales@MozhnoClub_Bot"), botInboxGroupId),
    true,
  );
  assert.equal(isBotInboxSalesCommand(groupContext(-100555, "/stats"), botInboxGroupId), false);
  assert.equal(isBotInboxSalesCommand(groupContext(-100999, "/sales"), botInboxGroupId), false);
});

test("allows sales reports for support and admins but not ordinary users", async () => {
  for (const role of [Role.SUPPORT, Role.ADMIN]) {
    let continued = false;
    const ctx = { dbUser: { role }, reply: async () => undefined } as unknown as AuthContext;
    await salesReportOnly()(ctx, async () => {
      continued = true;
    });
    assert.equal(continued, true);
  }

  let deniedMessage = "";
  const userCtx = {
    dbUser: { role: Role.USER },
    reply: async (message: string) => {
      deniedMessage = message;
    },
  } as unknown as AuthContext;
  await salesReportOnly()(userCtx, async () => {
    assert.fail("ordinary user must not continue to the sales report");
  });
  assert.equal(deniedMessage, "У вас нет прав для выполнения этой команды.");
});
