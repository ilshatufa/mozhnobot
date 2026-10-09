import { z } from "zod";
import type { ClubEvent, Prisma } from "@prisma/client";
import type {
  ClubEventInput,
  ClubEventRepository,
} from "../repositories/club-event.repository.js";

const paymentEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.literal("subscription.activated"),
  clubId: z.string().uuid(),
  clubName: z.string().min(1).max(200),
  subscriptionId: z.string().uuid(),
  telegramUserId: z.number().int().positive().safe(),
  paidAt: z.string().datetime({ offset: true }),
  inviteUrl: z.string().url().nullable(),
});

export type ClubniPaymentEvent = z.infer<typeof paymentEventSchema>;

type OnboardingStep =
  | "intro"
  | "video1"
  | "answer"
  | "video2"
  | "access"
  | "final";

export const CLUBNI_ONBOARDING_START_PREFIX = "clubni_onboarding:start:";
export const CLUBNI_ONBOARDING_NEXT_PREFIX = "clubni_onboarding:next:";
export const CLUBNI_ACCESS_INVITE_PREFIX = "Clubni ";

export function clubniAccessInviteName(telegramUserId: number): string {
  return `${CLUBNI_ACCESS_INVITE_PREFIX}${telegramUserId}`;
}

export function clubniAccessInviteTarget(name: string | undefined): number | null {
  if (!name?.startsWith(CLUBNI_ACCESS_INVITE_PREFIX)) return null;
  const rawId = name.slice(CLUBNI_ACCESS_INVITE_PREFIX.length);
  if (!/^\d+$/.test(rawId)) return null;
  const telegramUserId = Number(rawId);
  return Number.isSafeInteger(telegramUserId) && telegramUserId > 0
    ? telegramUserId
    : null;
}

export function clubniAccessJoinDecision(
  name: string | undefined,
  requesterTelegramUserId: number,
): "ignore" | "approve" | "decline" {
  const targetTelegramUserId = clubniAccessInviteTarget(name);
  if (targetTelegramUserId === null) return "ignore";
  return targetTelegramUserId === requesterTelegramUserId
    ? "approve"
    : "decline";
}

type ClubniAccessTelegram = {
  unbanChatMember(
    chatId: string,
    userId: number,
    extra: { only_if_banned: true },
  ): Promise<unknown>;
  createChatInviteLink(
    chatId: string,
    extra: { name: string; creates_join_request: true },
  ): Promise<{ invite_link: string }>;
};

export async function createClubniAccessInvite(
  telegram: ClubniAccessTelegram,
  chatId: string,
  telegramUserId: number,
): Promise<string> {
  await telegram.unbanChatMember(chatId, telegramUserId, {
    only_if_banned: true,
  });
  const invite = await telegram.createChatInviteLink(chatId, {
    name: clubniAccessInviteName(telegramUserId),
    creates_join_request: true,
  });
  return invite.invite_link;
}

type ClubniJoinRequestTelegram = {
  approveChatJoinRequest(chatId: string, userId: number): Promise<unknown>;
  revokeChatInviteLink(chatId: string, inviteLink: string): Promise<unknown>;
};

export async function approveClubniAccessJoinRequest(
  telegram: ClubniJoinRequestTelegram,
  chatId: string,
  telegramUserId: number,
  inviteLink: string,
): Promise<void> {
  await telegram.approveChatJoinRequest(chatId, telegramUserId);
  await telegram.revokeChatInviteLink(chatId, inviteLink);
}

export const CLUBNI_PAYMENT_WELCOME_TEXT = [
  "Огонь, поздравляю, ты уже в клубе👌",
  "⠀",
  "Перед тем, как ты зайдешь, очень кратко расскажу о нас и о том, как всё устроено, чтобы тебе сразу всё было просто и понятно.",
  "⠀",
  "Жми кнопку ⤵️",
].join("\n");

export const CLUBNI_ONBOARDING_QUESTION =
  "Что привело тебя в клуб «МОЖНО» и чего ты ждёшь от участия?";

export const CLUBNI_ONBOARDING_FINAL_TEXT = [
  "В клубе «МОЖНО» не нужно успевать всё сразу.",
  "⠀",
  "Начни со спокойного знакомства: посмотри закреплённые сообщения, правила и навигацию. Внутри уже собраны основные материалы и подсказки, где что находится.",
  "⠀",
  "Если появится вопрос — задавай его в клубе. Можно идти маленькими шагами и включаться в своём темпе.",
].join("\n");

type OnboardingRepository = Pick<
  ClubEventRepository,
  "createIfNotExists" | "findByDedupeKey" | "findLatestForTarget"
>;

function stepDedupeKey(subscriptionId: string, step: OnboardingStep): string {
  return `clubni_onboarding:${subscriptionId}:${step}`;
}

function paymentPayload(event: ClubniPaymentEvent): Prisma.InputJsonValue {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    clubId: event.clubId,
    clubName: event.clubName,
    subscriptionId: event.subscriptionId,
    telegramUserId: event.telegramUserId,
    paidAt: event.paidAt,
    inviteUrl: event.inviteUrl,
  };
}

function storedPaymentEvent(event: ClubEvent | null): ClubniPaymentEvent | null {
  if (!event) return null;
  const parsed = paymentEventSchema.safeParse(event.payload);
  return parsed.success ? parsed.data : null;
}

async function markStep(
  repository: OnboardingRepository,
  event: ClubniPaymentEvent,
  step: OnboardingStep,
  payload: Prisma.InputJsonValue = {},
): Promise<ClubEvent | null> {
  const input: ClubEventInput = {
    dedupeKey: stepDedupeKey(event.subscriptionId, step),
    eventType: `clubni_onboarding_${step}`,
    targetUserTelegramId: BigInt(event.telegramUserId),
    occurredAt: new Date(),
    payload: {
      clubId: event.clubId,
      subscriptionId: event.subscriptionId,
      ...(payload as Record<string, Prisma.InputJsonValue>),
    },
  };
  return repository.createIfNotExists(input);
}

async function hasStep(
  repository: OnboardingRepository,
  event: ClubniPaymentEvent,
  step: OnboardingStep,
): Promise<boolean> {
  return Boolean(
    await repository.findByDedupeKey(stepDedupeKey(event.subscriptionId, step)),
  );
}

async function accessInviteUrl(
  repository: OnboardingRepository,
  event: ClubniPaymentEvent,
): Promise<string | null> {
  const access = await repository.findByDedupeKey(
    stepDedupeKey(event.subscriptionId, "access"),
  );
  if (!access?.payload || typeof access.payload !== "object" || Array.isArray(access.payload)) {
    return null;
  }
  const inviteUrl = (access.payload as Record<string, unknown>).inviteUrl;
  return typeof inviteUrl === "string" && z.string().url().safeParse(inviteUrl).success
    ? inviteUrl
    : null;
}

async function ensureAccessInvite(
  repository: OnboardingRepository,
  event: ClubniPaymentEvent,
  createInvite: (event: ClubniPaymentEvent) => Promise<string>,
): Promise<string> {
  const existing = await accessInviteUrl(repository, event);
  if (existing) return existing;

  const inviteUrl = z.string().url().parse(await createInvite(event));
  const created = await markStep(repository, event, "access", { inviteUrl });
  if (created) return inviteUrl;

  return await accessInviteUrl(repository, event) ?? inviteUrl;
}

export function parseClubniPaymentCommand(text: string): ClubniPaymentEvent | null {
  const match = text.match(/^\/clubni_payment\s+([A-Za-z0-9_-]+)$/);
  if (!match) return null;

  try {
    const decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    const parsed = paymentEventSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function findLatestClubniPayment(
  telegramUserId: number,
  expectedClubId: string,
  repository: OnboardingRepository,
): Promise<ClubniPaymentEvent | null> {
  const event = storedPaymentEvent(
    await repository.findLatestForTarget(
      "clubni_payment_succeeded",
      BigInt(telegramUserId),
    ),
  );
  return event?.clubId === expectedClubId ? event : null;
}

type DeliveryDependencies = {
  repository: OnboardingRepository;
  sendIntro: (event: ClubniPaymentEvent) => Promise<unknown>;
};

export async function deliverClubniPaymentWelcome(
  event: ClubniPaymentEvent,
  expectedClubId: string,
  dependencies: DeliveryDependencies,
): Promise<"wrong_club" | "duplicate" | "pending" | "delivered"> {
  if (event.clubId !== expectedClubId) return "wrong_club";

  const created = await dependencies.repository.createIfNotExists({
    dedupeKey: `clubni_payment:${event.eventId}`,
    eventType: "clubni_payment_succeeded",
    targetUserTelegramId: BigInt(event.telegramUserId),
    occurredAt: new Date(event.paidAt),
    payload: paymentPayload(event),
  });
  if (await hasStep(dependencies.repository, event, "intro")) {
    return created ? "delivered" : "duplicate";
  }

  try {
    await dependencies.sendIntro(event);
  } catch {
    return "pending";
  }
  await markStep(dependencies.repository, event, "intro");
  return "delivered";
}

export async function clubniOnboardingState(
  event: ClubniPaymentEvent,
  repository: OnboardingRepository,
): Promise<OnboardingStep | "payment"> {
  for (const step of ["final", "access", "video2", "answer", "video1", "intro"] as const) {
    if (await hasStep(repository, event, step)) return step;
  }
  return "payment";
}

export async function sendOrResumeClubniOnboarding(
  event: ClubniPaymentEvent,
  repository: OnboardingRepository,
  senders: {
    sendIntro: (event: ClubniPaymentEvent) => Promise<unknown>;
    sendQuestionReminder: (event: ClubniPaymentEvent) => Promise<unknown>;
    sendVideo2: (event: ClubniPaymentEvent) => Promise<unknown>;
    createInvite: (event: ClubniPaymentEvent) => Promise<string>;
    sendFinal: (event: ClubniPaymentEvent, inviteUrl: string) => Promise<unknown>;
  },
): Promise<OnboardingStep | "payment"> {
  const state = await clubniOnboardingState(event, repository);
  if (state === "final") {
    return state;
  }
  if (state === "access") {
    const inviteUrl = await ensureAccessInvite(
      repository,
      event,
      senders.createInvite,
    );
    await senders.sendFinal(event, inviteUrl);
    await markStep(repository, event, "final");
  } else if (state === "video2") {
    await senders.sendVideo2(event);
  } else if (state === "answer") {
    await senders.sendVideo2(event);
    await markStep(repository, event, "video2");
  } else if (state === "video1") {
    await senders.sendQuestionReminder(event);
  } else {
    await senders.sendIntro(event);
    await markStep(repository, event, "intro");
  }
  return state;
}

export async function startClubniOnboarding(
  event: ClubniPaymentEvent,
  repository: OnboardingRepository,
  sendVideo1: (event: ClubniPaymentEvent) => Promise<unknown>,
): Promise<"duplicate" | "started"> {
  if (await hasStep(repository, event, "video1")) return "duplicate";
  await sendVideo1(event);
  await markStep(repository, event, "video1");
  return "started";
}

export async function saveClubniOnboardingAnswer(
  event: ClubniPaymentEvent,
  answer: string,
  repository: OnboardingRepository,
  sendVideo2: (event: ClubniPaymentEvent) => Promise<unknown>,
): Promise<"not_awaiting" | "duplicate" | "saved"> {
  if (!await hasStep(repository, event, "video1")) return "not_awaiting";
  if (await hasStep(repository, event, "answer")) return "duplicate";

  const normalizedAnswer = answer.trim().slice(0, 4000);
  if (!normalizedAnswer) return "not_awaiting";
  await markStep(repository, event, "answer", { answer: normalizedAnswer });
  await sendVideo2(event);
  await markStep(repository, event, "video2");
  return "saved";
}

export async function finishClubniOnboarding(
  event: ClubniPaymentEvent,
  repository: OnboardingRepository,
  createInvite: (event: ClubniPaymentEvent) => Promise<string>,
  sendFinal: (event: ClubniPaymentEvent, inviteUrl: string) => Promise<unknown>,
): Promise<"not_ready" | "duplicate" | "finished"> {
  if (!await hasStep(repository, event, "video2")) return "not_ready";
  const inviteUrl = await ensureAccessInvite(repository, event, createInvite);
  await sendFinal(event, inviteUrl);
  if (await hasStep(repository, event, "final")) return "duplicate";
  await markStep(repository, event, "final");
  return "finished";
}
