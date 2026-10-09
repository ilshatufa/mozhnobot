import assert from "node:assert/strict";
import test from "node:test";
import type { ClubEvent } from "@prisma/client";
import {
  CLUBNI_PAYMENT_WELCOME_TEXT,
  approveClubniAccessJoinRequest,
  clubniAccessInviteName,
  createClubniAccessInvite,
  clubniAccessJoinDecision,
  clubniAccessInviteTarget,
  clubniOnboardingState,
  deliverClubniPaymentWelcome,
  findLatestClubniPayment,
  finishClubniOnboarding,
  parseClubniPaymentCommand,
  saveClubniOnboardingAnswer,
  sendOrResumeClubniOnboarding,
  startClubniOnboarding,
  type ClubniPaymentEvent,
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
  inviteUrl: null,
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

test("decodes a valid Clubni payment command without a Clubni invite", () => {
  const encoded = Buffer.from(JSON.stringify(payment), "utf8").toString("base64url");
  assert.deepEqual(parseClubniPaymentCommand(`/clubni_payment ${encoded}`), payment);
  assert.equal(parseClubniPaymentCommand("/clubni_payment invalid"), null);
});

test("binds a Clubni join-request link name to one Telegram user", () => {
  assert.equal(clubniAccessInviteName(301474421), "Clubni 301474421");
  assert.equal(clubniAccessInviteTarget("Clubni 301474421"), 301474421);
  assert.equal(clubniAccessInviteTarget("Clubni 301474422"), 301474422);
  assert.equal(clubniAccessInviteTarget("Other 301474421"), null);
  assert.equal(clubniAccessInviteTarget("Clubni invalid"), null);
  assert.equal(clubniAccessJoinDecision("Clubni 301474421", 301474421), "approve");
  assert.equal(clubniAccessJoinDecision("Clubni 301474421", 301474422), "decline");
  assert.equal(clubniAccessJoinDecision("Other 301474421", 301474421), "ignore");
});

test("unbans a returning member before creating the personal invite", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const inviteUrl = await createClubniAccessInvite(
    {
      async unbanChatMember(chatId, userId, extra) {
        calls.push({ method: "unban", payload: { chatId, userId, extra } });
      },
      async createChatInviteLink(chatId, extra) {
        calls.push({ method: "invite", payload: { chatId, extra } });
        return { invite_link: "https://t.me/+personal" };
      },
    },
    "-1001234567890",
    301474421,
  );

  assert.equal(inviteUrl, "https://t.me/+personal");
  assert.deepEqual(calls, [
    {
      method: "unban",
      payload: {
        chatId: "-1001234567890",
        userId: 301474421,
        extra: { only_if_banned: true },
      },
    },
    {
      method: "invite",
      payload: {
        chatId: "-1001234567890",
        extra: {
          name: "Clubni 301474421",
          creates_join_request: true,
        },
      },
    },
  ]);
});

test("revokes a personal invite after approving its intended member", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  await approveClubniAccessJoinRequest(
    {
      async approveChatJoinRequest(chatId, userId) {
        calls.push({ method: "approve", payload: { chatId, userId } });
      },
      async revokeChatInviteLink(chatId, inviteLink) {
        calls.push({ method: "revoke", payload: { chatId, inviteLink } });
      },
    },
    "-1001234567890",
    301474421,
    "https://t.me/+personal",
  );

  assert.deepEqual(calls, [
    {
      method: "approve",
      payload: { chatId: "-1001234567890", userId: 301474421 },
    },
    {
      method: "revoke",
      payload: {
        chatId: "-1001234567890",
        inviteLink: "https://t.me/+personal",
      },
    },
  ]);
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
    await finishClubniOnboarding(
      payment,
      repository,
      async () => "https://t.me/+custom-bot-invite",
      async (_event, inviteUrl) => {
        assert.equal(inviteUrl, "https://t.me/+custom-bot-invite");
        delivered.push("final");
      },
    ),
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
  const access = repository.events.find(
    (event) => event.eventType === "clubni_onboarding_access",
  );
  assert.deepEqual(access?.payload, {
    clubId: payment.clubId,
    subscriptionId: payment.subscriptionId,
    inviteUrl: "https://t.me/+custom-bot-invite",
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
    await finishClubniOnboarding(
      payment,
      repository,
      async () => "https://t.me/+unused",
      async () => {},
    ),
    "not_ready",
  );
});

test("does not resend the final step when completed onboarding is resumed", async () => {
  const repository = new MemoryClubEventRepository();
  await deliverClubniPaymentWelcome(payment, payment.clubId, {
    repository,
    async sendIntro() {},
  });
  await startClubniOnboarding(payment, repository, async () => {});
  await saveClubniOnboardingAnswer(payment, "Ответ", repository, async () => {});

  let createdInvites = 0;
  const delivered: string[] = [];
  const createInvite = async () => {
    createdInvites += 1;
    return "https://t.me/+custom-bot-invite";
  };
  const sendFinal = async (_event: ClubniPaymentEvent, inviteUrl: string) => {
    delivered.push(inviteUrl);
  };

  assert.equal(
    await finishClubniOnboarding(
      payment,
      repository,
      createInvite,
      sendFinal,
    ),
    "finished",
  );
  assert.equal(
    await sendOrResumeClubniOnboarding(payment, repository, {
      sendIntro: async () => {},
      sendQuestionReminder: async () => {},
      sendVideo2: async () => {},
      createInvite,
      sendFinal,
    }),
    "final",
  );
  assert.deepEqual(delivered, ["https://t.me/+custom-bot-invite"]);
  assert.equal(
    await finishClubniOnboarding(
      payment,
      repository,
      createInvite,
      sendFinal,
    ),
    "duplicate",
  );
  assert.equal(createdInvites, 1);
  assert.deepEqual(delivered, [
    "https://t.me/+custom-bot-invite",
    "https://t.me/+custom-bot-invite",
  ]);
});
