import assert from "node:assert/strict";
import test from "node:test";
import type { ClubEvent } from "@prisma/client";
import type { ClubEventInput } from "../repositories/club-event.repository.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";
import { groupAccessMiddleware } from "../middlewares/group-access.js";
import { config } from "../config.js";
import {
  clubniRemovalReason, deliverClubniRemovalNotice, parseClubniRemovalCommand,
  receiveClubniRemoval, type ClubniRemovalEvent,
} from "./clubni-removal.service.js";

const event: ClubniRemovalEvent = {
  eventId: "member:2026-11-14T02:25:27.000Z",
  clubId: "a4bdeb8f-10b3-41a9-8d6a-cf145f5148d8", telegramChatId: "-1003393970920",
  telegramUserId: 2090762061, removalStartedAt: "2026-11-14T02:25:27.000Z",
  removedAt: "2026-11-14T02:25:28.000Z", reason: "auto_renew_canceled",
};
const notice = {
  clubId: event.clubId, chatId: event.telegramChatId, userId: event.telegramUserId,
  removedAt: new Date("2026-11-14T02:25:27.000Z"),
  text: "🤖 <b>Удалён из клуба — Clubni</b>\n\n@faery86 · Вера Филимонова",
};

function fixture() {
  const rows: ClubEvent[] = [];
  const messages: string[] = [];
  const edits: Array<{ id: number; text: string }> = [];
  const repository = {
    async createIfNotExists(input: ClubEventInput): Promise<ClubEvent | null> {
      if (rows.some((row) => row.dedupeKey === input.dedupeKey)) return null;
      const row: ClubEvent = {
        id: rows.length + 1, createdAt: new Date(),
        dedupeKey: input.dedupeKey, eventType: input.eventType, occurredAt: input.occurredAt,
        telegramUpdateId: input.telegramUpdateId ?? null,
        chatTelegramId: input.chatTelegramId ?? null,
        telegramMessageThreadId: input.telegramMessageThreadId ?? null,
        userTelegramId: input.userTelegramId ?? null,
        messageTelegramId: input.messageTelegramId ?? null,
        targetUserTelegramId: input.targetUserTelegramId ?? null,
        targetMessageTelegramId: input.targetMessageTelegramId ?? null,
        payload: (input.payload ?? null) as ClubEvent["payload"],
      };
      rows.push(row);
      return row;
    },
    async findByDedupeKey(key: string) { return rows.find((row) => row.dedupeKey === key) ?? null; },
    async findLatestForTargetInChat(type: string, userId: bigint, chatId: bigint, since: Date, until: Date) {
      return rows.filter((row) => row.eventType === type && row.targetUserTelegramId === userId &&
        row.chatTelegramId === chatId && row.occurredAt >= since && row.occurredAt <= until)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null;
    },
  };
  return { rows, messages, edits, repository,
    async send(text: string) { messages.push(text); return { message_id: messages.length + 100 }; },
    async edit(id: number, text: string) { edits.push({ id, text }); },
  };
}

test("validates the bot-to-bot contract and rejects malformed or unsupported reasons", () => {
  const command = (payload: unknown) => `/clubni_removal ${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  assert.deepEqual(parseClubniRemovalCommand(command(event)), event);
  for (const payload of [{ ...event, reason: "guessed_reason" }, { ...event, telegramUserId: -1 },
    { ...event, removedAt: "2026-11-13T00:00:00Z" }, { ...event, clubId: "foreign" }]) {
    assert.equal(parseClubniRemovalCommand(command(payload)), null);
  }
  assert.equal(parseClubniRemovalCommand("/clubni_removal !!!"), null);
  assert.equal(parseClubniRemovalCommand("/clubni_payment test"), null);
});

test("formats all explicit causes without exposing enum values", () => {
  for (const reason of ["auto_renew_canceled", "payment_failed", "admin_terminated", "member_left", "gift_ended", "other", "administrator_removed"] as const) {
    assert.ok(clubniRemovalReason(reason).length > 15);
    assert.ok(!clubniRemovalReason(reason).includes("_"));
  }
  assert.match(clubniRemovalReason("auto_renew_canceled"), /автопродление отключено/);
  assert.match(clubniRemovalReason("payment_failed"), /льготный срок закончился/);
});

test("a reason received first appears in the original removal notice", async () => {
  const f = fixture();
  await receiveClubniRemoval(event, event.clubId, event.telegramChatId, f);
  await deliverClubniRemovalNotice(notice, f);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /Причина:.*автопродление отключено/);
  assert.equal(f.edits.length, 0);
});

test("a reason received later updates the same message; duplicate events create no new notice", async () => {
  const f = fixture();
  await deliverClubniRemovalNotice(notice, f);
  await receiveClubniRemoval(event, event.clubId, event.telegramChatId, f);
  await receiveClubniRemoval(event, event.clubId, event.telegramChatId, f);
  await deliverClubniRemovalNotice(notice, f);
  assert.equal(f.messages.length, 1);
  assert.ok(f.edits.every((edit) => edit.id === 101 && edit.text.includes("автопродление отключено")));
  assert.equal(f.rows.filter((row) => row.eventType === "clubni_removal_reason").length, 1);
});

test("a reason arriving while sendMessage is in progress is applied afterwards", async () => {
  const f = fixture();
  await deliverClubniRemovalNotice(notice, { ...f, async send(text) {
    await receiveClubniRemoval(event, event.clubId, event.telegramChatId, f);
    return f.send(text);
  } });
  assert.equal(f.messages.length, 1);
  assert.equal(f.edits.length, 1);
  assert.match(f.edits[0].text, /Причина:/);
});

test("another club, group, participant or historical removal cannot alter the notice", async () => {
  const f = fixture();
  await deliverClubniRemovalNotice(notice, f);
  assert.equal(await receiveClubniRemoval({ ...event, clubId: "11111111-1111-4111-8111-111111111111" },
    event.clubId, event.telegramChatId, f), "wrong_club");
  assert.equal(await receiveClubniRemoval({ ...event, telegramChatId: "-100999" },
    event.clubId, event.telegramChatId, f), "wrong_club");
  await receiveClubniRemoval({ ...event, eventId: "another-user", telegramUserId: 123 }, event.clubId, event.telegramChatId, f);
  await receiveClubniRemoval({ ...event, eventId: "old", removalStartedAt: "2026-11-13T02:25:27Z", removedAt: "2026-11-13T02:25:28Z" },
    event.clubId, event.telegramChatId, f);
  assert.equal(f.edits.length, 0);
  assert.equal(f.messages.length, 1);
});

test("replaying the same edit tolerates Telegram's not-modified response, while real failures propagate", async () => {
  const f = fixture();
  await deliverClubniRemovalNotice(notice, f);
  await receiveClubniRemoval(event, event.clubId, event.telegramChatId, { ...f,
    async edit() { throw new Error("400: message is not modified"); } });
  await assert.rejects(receiveClubniRemoval(event, event.clubId, event.telegramChatId, { ...f,
    async edit() { throw new Error("Forbidden"); } }), /Forbidden/);
});

test("middleware accepts a removal reason only from the configured bot's private chat", async (t) => {
  assert.equal(config.clubniPayment.enabled, true, "test requires configured bot-to-bot integration");
  const f = fixture();
  const originalCreate = clubEventRepository.createIfNotExists;
  const originalFind = clubEventRepository.findLatestForTargetInChat;
  clubEventRepository.createIfNotExists = f.repository.createIfNotExists;
  clubEventRepository.findLatestForTargetInChat = f.repository.findLatestForTargetInChat;
  t.after(() => {
    clubEventRepository.createIfNotExists = originalCreate;
    clubEventRepository.findLatestForTargetInChat = originalFind;
  });
  const payload = { ...event, clubId: config.clubniPayment.clubId, telegramChatId: config.clubGroupId };
  const text = `/clubni_removal ${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const sourceId = Number(config.clubniPayment.sourceBotTelegramId);
  let nextCalls = 0;
  for (const sender of [
    { id: sourceId + 1, is_bot: true, chatType: "private" },
    { id: sourceId, is_bot: false, chatType: "private" },
    { id: sourceId, is_bot: true, chatType: "supergroup" },
    { id: sourceId, is_bot: true, chatType: "private" },
  ]) {
    await groupAccessMiddleware()({
      from: { id: sender.id, is_bot: sender.is_bot }, chat: { type: sender.chatType },
      message: { text }, update: {}, telegram: { async editMessageText() { throw new Error("no notice to edit"); } },
    } as never, async () => { nextCalls++; });
  }
  assert.equal(nextCalls, 3);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].eventType, "clubni_removal_reason");
});
