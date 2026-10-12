import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { type AuthContext } from "../middlewares/auth.js";

const SALES_CAMPAIGN_EVENT_PREFIX = "waitlist_broadcast_";
const PAYMENT_EVENT = "clubni_payment_succeeded";
const ONBOARDING_EVENTS = [
  "clubni_onboarding_intro",
  "clubni_onboarding_answer",
  "clubni_onboarding_access",
  "clubni_onboarding_final",
] as const;

const reportDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Yekaterinburg",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type PaymentWithoutMembership = {
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  paidAt: Date;
};

export type SalesReport = {
  startedAt: Date;
  delivered: number;
  paid: number;
  paidAndJoined: number;
  paidWithoutMembership: PaymentWithoutMembership[];
  onboardingStarted: number;
  onboardingAnswered: number;
  onboardingAccessGranted: number;
  onboardingCompleted: number;
};

function campaignFromPayload(payload: Prisma.JsonValue | null): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const campaign = (payload as Prisma.JsonObject).campaign;
  return typeof campaign === "string" && campaign.length > 0 ? campaign : null;
}

function escapeRichMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");
}

function personLink(person: PaymentWithoutMembership): string {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
  if (person.username) {
    const label = name ? `@${person.username} · ${name}` : `@${person.username}`;
    return `[${escapeRichMarkdown(label)}](https://t.me/${person.username})`;
  }

  const label = name || `Telegram ID ${person.telegramId}`;
  return `[${escapeRichMarkdown(label)}](tg://user?id=${person.telegramId})`;
}

function countUsersByEvent(
  events: Array<{ eventType: string; targetUserTelegramId: bigint | null }>,
  eventType: string,
): number {
  return new Set(
    events
      .filter((event) => event.eventType === eventType && event.targetUserTelegramId !== null)
      .map((event) => String(event.targetUserTelegramId)),
  ).size;
}

export function buildSalesReportMarkdown(report: SalesReport): string {
  const unpaidMembershipLines = report.paidWithoutMembership.map((person, index) =>
    `${index + 1}\\. ${personLink(person)} — ${escapeRichMarkdown(reportDateFormatter.format(person.paidAt))}`,
  );

  return [
    "# Продажи",
    "",
    `**Период:** с ${escapeRichMarkdown(reportDateFormatter.format(report.startedAt))}`,
    `**Получили рассылку:** ${report.delivered}`,
    `**Оплатили:** ${report.paid}`,
    `**Оплатили и вступили:** ${report.paidAndJoined}`,
    `**Оплатили, но не вступили:** ${report.paidWithoutMembership.length}`,
    "",
    "## Онбординг после оплаты",
    "",
    `Начали: ${report.onboardingStarted}`,
    `Ответили на вопрос: ${report.onboardingAnswered}`,
    `Получили доступ: ${report.onboardingAccessGranted}`,
    `Завершили: ${report.onboardingCompleted}`,
    "",
    "## Оплатили, но не вступили",
    "",
    ...(unpaidMembershipLines.length
      ? unpaidMembershipLines
      : ["Все оплатившие вступили в клуб ✅"]),
  ].join("\n");
}

async function loadSalesReport(): Promise<SalesReport | null> {
  const latestDelivery = await prisma.clubEvent.findFirst({
    where: { eventType: "waitlist_broadcast_sent" },
    orderBy: { occurredAt: "desc" },
    select: { payload: true },
  });
  const campaign = campaignFromPayload(latestDelivery?.payload ?? null);
  if (!campaign) return null;

  const campaignEvents = await prisma.clubEvent.findMany({
    where: {
      eventType: { startsWith: SALES_CAMPAIGN_EVENT_PREFIX },
      payload: { path: ["campaign"], equals: campaign },
    },
    select: {
      eventType: true,
      targetUserTelegramId: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "asc" },
  });
  const startedAt = campaignEvents.at(0)?.occurredAt;
  if (!startedAt) return null;

  const deliveredUserIds = new Set(
    campaignEvents
      .filter((event) => event.eventType === "waitlist_broadcast_sent")
      .flatMap((event) => event.targetUserTelegramId === null
        ? []
        : [String(event.targetUserTelegramId)]),
  );

  const paymentEvents = await prisma.clubEvent.findMany({
    where: {
      eventType: PAYMENT_EVENT,
      occurredAt: { gte: startedAt },
      targetUserTelegramId: { not: null },
    },
    select: {
      targetUserTelegramId: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "asc" },
  });
  const firstPaymentByUser = new Map<string, { telegramId: bigint; paidAt: Date }>();
  for (const payment of paymentEvents) {
    if (payment.targetUserTelegramId === null) continue;
    const key = String(payment.targetUserTelegramId);
    if (!firstPaymentByUser.has(key)) {
      firstPaymentByUser.set(key, {
        telegramId: payment.targetUserTelegramId,
        paidAt: payment.occurredAt,
      });
    }
  }

  const paymentUserIds = [...firstPaymentByUser.values()].map((payment) => payment.telegramId);
  const [users, onboardingEvents] = await Promise.all([
    paymentUserIds.length
      ? prisma.user.findMany({
          where: { telegramId: { in: paymentUserIds } },
          select: {
            telegramId: true,
            username: true,
            firstName: true,
            lastName: true,
            joinedAt: true,
          },
        })
      : [],
    paymentUserIds.length
      ? prisma.clubEvent.findMany({
          where: {
            eventType: { in: [...ONBOARDING_EVENTS] },
            targetUserTelegramId: { in: paymentUserIds },
            occurredAt: { gte: startedAt },
          },
          select: { eventType: true, targetUserTelegramId: true },
        })
      : [],
  ]);
  const usersByTelegramId = new Map(users.map((user) => [String(user.telegramId), user]));

  const paidWithoutMembership = [...firstPaymentByUser.values()]
    .filter((payment) => !usersByTelegramId.get(String(payment.telegramId))?.joinedAt)
    .map((payment) => {
      const user = usersByTelegramId.get(String(payment.telegramId));
      return {
        telegramId: payment.telegramId,
        username: user?.username ?? null,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        paidAt: payment.paidAt,
      };
    });

  return {
    startedAt,
    delivered: deliveredUserIds.size,
    paid: firstPaymentByUser.size,
    paidAndJoined: firstPaymentByUser.size - paidWithoutMembership.length,
    paidWithoutMembership,
    onboardingStarted: countUsersByEvent(onboardingEvents, "clubni_onboarding_intro"),
    onboardingAnswered: countUsersByEvent(onboardingEvents, "clubni_onboarding_answer"),
    onboardingAccessGranted: countUsersByEvent(onboardingEvents, "clubni_onboarding_access"),
    onboardingCompleted: countUsersByEvent(onboardingEvents, "clubni_onboarding_final"),
  };
}

async function sendRichReport(ctx: AuthContext, markdown: string): Promise<void> {
  await ctx.telegram.callApi("sendRichMessage" as never, {
    chat_id: ctx.chat!.id,
    rich_message: { markdown },
  } as never);
}

export async function salesReportHandler(ctx: AuthContext): Promise<void> {
  if (!config.botInboxGroupId || String(ctx.chat?.id) !== config.botInboxGroupId) {
    await ctx.reply("Команда /sales доступна в группе входящих сообщений МожноБота.");
    return;
  }

  const report = await loadSalesReport();
  if (!report) {
    await sendRichReport(ctx, "# Продажи\n\nДанные о кампании рассылки пока отсутствуют\\.");
    return;
  }

  await sendRichReport(ctx, buildSalesReportMarkdown(report));
}
