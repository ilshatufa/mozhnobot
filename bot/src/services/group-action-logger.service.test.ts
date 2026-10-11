import assert from "node:assert/strict";
import test from "node:test";
import type { Telegram } from "telegraf";
import type { ClubEventInput } from "../repositories/club-event.repository.js";
import { installGroupActionLogging } from "./group-action-logger.service.js";

function fakeTelegram(
  implementation: (method: string, payload: unknown) => Promise<unknown>,
): Telegram {
  return {
    callApi: implementation,
  } as unknown as Telegram;
}

function recordingRepository(events: ClubEventInput[]) {
  return {
    async createIfNotExists(event: ClubEventInput) {
      events.push(event);
      return null;
    },
  };
}

test("persists safe metadata for a successful bot action in a group", async () => {
  const events: ClubEventInput[] = [];
  const telegram = fakeTelegram(async () => ({ message_id: 77 }));
  installGroupActionLogging(telegram, recordingRepository(events));

  await telegram.callApi("sendMessage", {
    chat_id: "-1001234567890",
    message_thread_id: 42,
    text: "private message text must not be logged",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "bot_group_action_succeeded");
  assert.equal(events[0].chatTelegramId, -1001234567890n);
  assert.equal(events[0].telegramMessageThreadId, 42);
  assert.equal(events[0].messageTelegramId, 77);
  assert.equal(JSON.stringify(events[0].payload).includes("private message text"), false);
});

test("persists a failed group action and rethrows the Telegram error", async () => {
  const events: ClubEventInput[] = [];
  const telegramError = {
    response: {
      error_code: 400,
      description: "Bad Request: PARTICIPANT_ID_INVALID",
    },
  };
  const telegram = fakeTelegram(async () => {
    throw telegramError;
  });
  installGroupActionLogging(telegram, recordingRepository(events));

  await assert.rejects(
    telegram.callApi("unbanChatMember", {
      chat_id: -1001234567890,
      user_id: 123456789,
      only_if_banned: false,
    }),
    (error) => error === telegramError,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "bot_group_action_failed");
  assert.equal(events[0].targetUserTelegramId, 123456789n);
  assert.partialDeepStrictEqual(events[0].payload, {
    method: "unbanChatMember",
    status: "failed",
    errorCode: 400,
    errorDescription: "Bad Request: PARTICIPANT_ID_INVALID",
  });
});

test("does not persist reads or actions in private chats", async () => {
  const events: ClubEventInput[] = [];
  const telegram = fakeTelegram(async () => true);
  installGroupActionLogging(telegram, recordingRepository(events));

  await telegram.callApi("getChatMember", {
    chat_id: -1001234567890,
    user_id: 123456789,
  });
  await telegram.callApi("sendMessage", {
    chat_id: 123456789,
    text: "private",
  });

  assert.equal(events.length, 0);
});
