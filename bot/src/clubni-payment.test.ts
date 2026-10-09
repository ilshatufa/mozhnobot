import assert from "node:assert/strict";
import test from "node:test";
import type { ClubEvent } from "@prisma/client";
import {
  CLUBNI_PAYMENT_WELCOME_TEXT,
  clubniOnboardingState,
  deliverClubniPaymentWelcome,
  findLatestClubniPayment,
  finishClubniOnboarding,
  parseClubniPaymentCommand,
  saveClubniOnboardingAnswer,
  startClubniOnboarding,
} from "./services/clubni-payment.service.js";
import type { ClubEventInput } from "./repositories/club-event.repository.js";

const payment = {
  eventId: "robokassa:connection:42",
  eventType: "subscription.activated" as const,
  clubId: "a4bdeb8f-10b3-41a9-8d6a-cf145f5148d8",
  clubName: "Клуб «МОЖНО»🔥",
  subscriptionId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 301474421,
  paidAt: "2026-10-09T10:00:00.000Z",
  inviteUrl: "https://t.me/+personal-invite",
};

class MemoryClubEventRepository {
  private sequence = 0;
  readonly events: ClubEvent[] = [];

  async createIfNotExists(input: ClubEventInput): Promise<ClubEvent | null> {
    if (this.events.some((event) => event.dedupeKey === input.dedupeKey)) {
      return null;
    }
    const event: ClubEvent = {
      id: ++this.sequence,
      telegramUpdateId: input.telegramUpdateId ?? null,
      dedupeKey: input.dedupeKey,
      eventType: input.eventType,
      chatTelegramId: input.chatTelegramId ?? null,
      telegramMessageThreadId: input.telegramMessageThreadId ?? null,
      userTelegramId: input.userTelegramId ?? null,
      messageTelegramId: input.messageTelegramId ?? null,
      targetUserTelegramId: input.targetUserTelegramId ?? null,
      targetMessageTelegramId: input.targetMessageTelegramId ?? null,
      occurredAt: input.occurredAt,
      payload: (input.payload ?? null) as ClubEvent["payload"],
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  async findByDedupeKey(dedupeKey: string): Promise<ClubEvent | null> {
    return this.events.find((event) => event.dedupeKey === dedupeKey) ?? null;
  }

  async findLatestForTarget(
    eventType: string,
    targetUserTelegramId: bigint,
  ): Promise<ClubEvent | null> {
    return [...this.events]
      .filter((event) =>
        event.eventType === eventType &&
        event.targetUserTelegramId === targetUserTelegramId
      )
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0] ?? null;
  }
}

test("decodes a valid Clubni payment command with the personal invite", () => {
  const encoded = Buffer.from(JSON.stringify(payment), "utf8").toString("base64url");
  assert.deepEqual(parseClubniPaymentCommand(`/clubni_payment ${encoded}`), payment);
  assert.equal(parseClubniPaymentCommand("/clubni_payment invalid"), null);
});

test("records the payment and delivers the intro only once", async () => {
  const repository = new MemoryClubEventRepository();
  const sent: string[] = [];
  const dependencies = {
    repository,
    async sendIntro() {
      sent.push(CLUBNI_PAYMENT_WELCOME_TEXT);
    },
  };

  assert.equal(
    await deliverClubniPaymentWelcome(payment, payment.clubId, dependencies),
    "delivered",
  );
  assert.equal(
    await deliverClubniPaymentWelcome(payment, payment.clubId, dependencies),
    "duplicate",
  );
  assert.deepEqual(sent, [CLUBNI_PAYMENT_WELCOME_TEXT]);
  assert.deepEqual(
    await findLatestClubniPayment(
      payment.telegramUserId,
      payment.clubId,
      repository,
    ),
    payment,
  );
});

test("keeps a trusted payment pending when the user has not started the bot", async () => {
  const repository = new MemoryClubEventRepository();
  assert.equal(
    await deliverClubniPaymentWelcome(payment, payment.clubId, {
      repository,
      async sendIntro() {
        throw new Error("bot was blocked");
      },
    }),
    "pending",
  );
  assert.deepEqual(
    await findLatestClubniPayment(
      payment.telegramUserId,
      payment.clubId,
      repository,
    ),
    payment,
  );
  assert.equal(await clubniOnboardingState(payment, repository), "payment");
});

test("ignores a payment for another club", async () => {
  const repository = new MemoryClubEventRepository();
  let called = false;
  const result = await deliverClubniPaymentWelcome(
    payment,
    "22222222-2222-4222-8222-222222222222",
    {
      repository,
      async sendIntro() {
        called = true;
      },
    },
  );
  assert.equal(result, "wrong_club");
  assert.equal(called, false);
  assert.equal(repository.events.length, 0);
});

test("runs video, answer, video and final link in order and stores the answer", async () => {
  const repository = new MemoryClubEventRepository();
  await deliverClubniPaymentWelcome(payment, payment.clubId, {
    repository,
    async sendIntro() {},
  });

  const delivered: string[] = [];
  assert.equal(
    await startClubniOnboarding(payment, repository, async () => {
      delivered.push("video1");
    }),
    "started",
  );
  assert.equal(
    await startClubniOnboarding(payment, repository, async () => {
      delivered.push("unexpected-video1");
    }),
    "duplicate",
  );
  assert.equal(
    await saveClubniOnboardingAnswer(
      payment,
      "  Хочу системно развивать свой проект  ",
      repository,
      async () => {
        delivered.push("video2");
      },
    ),
    "saved",
  );
  assert.equal(
    await finishClubniOnboarding(payment, repository, async (event) => {
      assert.equal(event.inviteUrl, payment.inviteUrl);
      delivered.push("final");
    }),
    "finished",
  );

  assert.deepEqual(delivered, ["video1", "video2", "final"]);
  assert.equal(await clubniOnboardingState(payment, repository), "final");
  const answer = repository.events.find(
    (event) => event.eventType === "clubni_onboarding_answer",
  );
  assert.deepEqual(answer?.payload, {
    clubId: payment.clubId,
    subscriptionId: payment.subscriptionId,
    answer: "Хочу системно развивать свой проект",
  });
});

test("does not accept an answer before the first video or finish before the second", async () => {
  const repository = new MemoryClubEventRepository();
  await deliverClubniPaymentWelcome(payment, payment.clubId, {
    repository,
    async sendIntro() {},
  });
  assert.equal(
    await saveClubniOnboardingAnswer(payment, "Ответ", repository, async () => {}),
    "not_awaiting",
  );
  assert.equal(
    await finishClubniOnboarding(payment, repository, async () => {}),
    "not_ready",
  );
});
