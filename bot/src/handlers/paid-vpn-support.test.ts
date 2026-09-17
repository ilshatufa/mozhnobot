import assert from "node:assert/strict";
import test from "node:test";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";
import {
  paidVpnSupportHandler,
  paidVpnSupportMessageHandler,
} from "./paid-vpn-support.js";

test("support button opens a force-reply prompt inside the VPN bot", async () => {
  let callbackAnswered = false;
  let replyText = "";
  let replyExtra: Record<string, unknown> | undefined;
  const ctx = {
    callbackQuery: { id: "callback" },
    answerCbQuery: async () => { callbackAnswered = true; },
    reply: async (text: string, extra: Record<string, unknown>) => {
      replyText = text;
      replyExtra = extra;
    },
  } as unknown as PaidVpnContext;

  await paidVpnSupportHandler(ctx);

  assert.equal(callbackAnswered, true);
  assert.match(replyText, /Поддержка МОЖНО VPN/);
  assert.equal(
    (replyExtra?.reply_markup as { force_reply?: boolean } | undefined)?.force_reply,
    true,
  );
});

test("admin reply is delivered to the user through the bot", async () => {
  const sent: Array<{ telegramId: number; text: string; extra: Record<string, unknown> }> = [];
  const copied: Array<{ telegramId: number; fromChatId: number; messageId: number }> = [];
  const confirmations: string[] = [];
  let nextCalled = false;
  const ctx = {
    isPaidVpnAdmin: true,
    chat: { id: 999 },
    message: {
      message_id: 50,
      text: "Проверь подключение <ещё раз>",
      reply_to_message: {
        text: "Ответ пользователю\nTelegram ID: 123456789\nНапиши ответ одним сообщением.",
      },
    },
    dbUser: { id: 1 },
    telegram: {
      sendMessage: async (
        telegramId: number,
        text: string,
        extra: Record<string, unknown>,
      ) => {
        sent.push({ telegramId, text, extra });
        return { message_id: 51 };
      },
      copyMessage: async (telegramId: number, fromChatId: number, messageId: number) => {
        copied.push({ telegramId, fromChatId, messageId });
        return { message_id: 52 };
      },
    },
    reply: async (text: string) => { confirmations.push(text); },
  } as unknown as PaidVpnContext;

  await paidVpnSupportMessageHandler(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(sent[0]?.telegramId, 123456789);
  assert.match(sent[0]?.text ?? "", /Ответ поддержки/);
  assert.deepEqual(copied[0], {
    telegramId: 123456789,
    fromChatId: 999,
    messageId: 50,
  });
  assert.match(confirmations[0] ?? "", /Ответ отправлен/);
});

test("user request is copied to the configured admin with identity and access status", async () => {
  const sent: Array<{ telegramId: number; text: string; extra: Record<string, unknown> }> = [];
  const copied: Array<{ telegramId: number; fromChatId: number; messageId: number }> = [];
  const confirmations: string[] = [];
  const ctx = {
    isPaidVpnAdmin: false,
    chat: { id: 123456789 },
    message: {
      message_id: 70,
      text: "Не подключается VPN",
      reply_to_message: {
        text: "Поддержка МОЖНО VPN\nОпиши проблему одним сообщением.",
      },
    },
    dbUser: {
      id: 7,
      telegramId: 123456789n,
      firstName: "Ильшат",
      lastName: null,
      username: "ilsh_at",
      isBanned: true,
      vpnBlocked: false,
    },
    telegram: {
      copyMessage: async (telegramId: number, fromChatId: number, messageId: number) => {
        copied.push({ telegramId, fromChatId, messageId });
        return { message_id: 71 };
      },
      sendMessage: async (
        telegramId: number,
        text: string,
        extra: Record<string, unknown>,
      ) => {
        sent.push({ telegramId, text, extra });
        return { message_id: 72 };
      },
    },
    reply: async (text: string) => { confirmations.push(text); },
  } as unknown as PaidVpnContext;

  await paidVpnSupportMessageHandler(ctx, async () => {});

  assert.deepEqual(copied[0], {
    telegramId: 999,
    fromChatId: 123456789,
    messageId: 70,
  });
  assert.equal(sent[0]?.telegramId, 999);
  assert.match(sent[0]?.text ?? "", /Ильшат · @ilsh_at/);
  assert.match(sent[0]?.text ?? "", /бот заблокирован/);
  assert.match(confirmations[0] ?? "", /Сообщение отправлено/);
});

test("ordinary messages continue to the payment handler", async () => {
  let nextCalled = false;
  const ctx = {
    isPaidVpnAdmin: false,
    message: { message_id: 60, text: "Обычное сообщение" },
  } as unknown as PaidVpnContext;

  await paidVpnSupportMessageHandler(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
