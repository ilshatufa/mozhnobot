import assert from "node:assert/strict";
import test from "node:test";
import {
  CLUBNI_PAYMENT_WELCOME_TEXT,
  deliverClubniPaymentWelcome,
  parseClubniPaymentCommand,
} from "./services/clubni-payment.service.js";

const event = {
  eventId: "robokassa:connection:42",
  eventType: "subscription.activated" as const,
  clubId: "a4bdeb8f-10b3-41a9-8d6a-cf145f5148d8",
  clubName: "Клуб «МОЖНО»🔥",
  subscriptionId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 301474421,
  paidAt: "2026-10-09T10:00:00.000Z",
};

test("decodes a valid Clubni payment command", () => {
  const encoded = Buffer.from(JSON.stringify(event), "utf8").toString("base64url");
  assert.deepEqual(parseClubniPaymentCommand(`/clubni_payment ${encoded}`), event);
  assert.equal(parseClubniPaymentCommand("/clubni_payment invalid"), null);
});

test("delivers the welcome once for the configured club", async () => {
  const sent: Array<{ telegramUserId: number; text: string }> = [];
  let createCalls = 0;
  const repository = {
    async createIfNotExists() {
      createCalls += 1;
      return createCalls === 1 ? ({ id: "event" } as never) : null;
    },
  };
  const dependencies = {
    repository,
    async sendMessage(telegramUserId: number, text: string) {
      sent.push({ telegramUserId, text });
    },
  };

  assert.equal(
    await deliverClubniPaymentWelcome(event, event.clubId, dependencies),
    "delivered",
  );
  assert.equal(
    await deliverClubniPaymentWelcome(event, event.clubId, dependencies),
    "duplicate",
  );
  assert.deepEqual(sent, [
    { telegramUserId: event.telegramUserId, text: CLUBNI_PAYMENT_WELCOME_TEXT },
  ]);
});

test("ignores a payment for another club", async () => {
  let called = false;
  const result = await deliverClubniPaymentWelcome(
    event,
    "22222222-2222-4222-8222-222222222222",
    {
      repository: {
        async createIfNotExists() {
          called = true;
          return null;
        },
      },
      async sendMessage() {
        called = true;
      },
    },
  );
  assert.equal(result, "wrong_club");
  assert.equal(called, false);
});
