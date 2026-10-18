import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";

const SALES_CAMPAIGN_EVENT_PREFIX = "waitlist_broadcast_";
const SALES_CAMPAIGNS = [
  { id: "waitlist-club-launch-first30-2026-10-11", wave: "волна 1" },
  { id: "waitlist-club-launch-next100-2026-10-12", wave: "волна 2" },
  { id: "waitlist-club-launch-remaining-2026-10-13", wave: "волна 3" },
  { id: "waitlist-club-launch-wave4-final-2026-10-14", wave: "волна 4" },
  { id: "waitlist-club-launch-wave6-2026-10-17", wave: "волна 6" },
] as const;
const SALES_WAVE5_STARTED_AT = new Date("2026-10-14T09:01:03.988Z");
const EXCLUDED_SALES_USER_IDS = new Set([
  "385886382", // aisylu_psy
  "6058947423", // timur_tets
  "5842794618", // developer135
]);
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

const percentageFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
});

type PaymentWithoutMembership = {
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  paidAt: Date;
  wave: string;
};

export type SalesReport = {
  startedAt: Date;
  delivered: number;
  cohort: number;
  notAuthorized: number;
  authorizedNotStarted: number;
  pending: number;
  paid: number;
  paidAndJoined: number;
  paidWithoutMembership: PaymentWithoutMembership[];
  onboardingStarted: number;
  onboardingAnswered: number;
  onboardingAccessGranted: number;
  onboardingCompleted: number;
};

type SalesCohortEntry = {
  telegramId: bigint;
  enteredAt: Date;
  wave: string;
};

const clubniFunnelSchema = z.object({
  cohort: z.number().int().nonnegative(),
  notAuthorized: z.number().int().nonnegative(),
  authorizedNotStarted: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});

function escapeRichMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");
}

function campaignFromPayload(payload: Prisma.JsonValue | null): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const campaign = (payload as Prisma.JsonObject).campaign;
  return typeof campaign === "string" ? campaign : null;
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
  const paidFromCohortPercent = percentageFormatter.format(
    report.cohort === 0 ? 0 : (report.paid / report.cohort) * 100,
  );
  const salesTable = [
    "| Воронка | Людей |",
    "| :--- | ---: |",
    `| Всего в воронке B1–B6 | **${report.cohort}** |`,
    `| Не авторизовались | **${report.notAuthorized}** |`,
    `| Авторизовались, но не начали оформление | **${report.authorizedNotStarted}** |`,
    `| Ожидают оплату — pending | **${report.pending}** |`,
    `| Оплатили | **${report.paid}** |`,
    `| Оплатили и вступили | **${report.paidAndJoined}** |`,
    `| Оплатили, но не вступили | **${report.paidWithoutMembership.length}** |`,
    `| Конверсия в оплату | **${paidFromCohortPercent}%** |`,
  ].join("\n");

  const onboardingTable = [
    "| Этап | Людей |",
    "| :--- | ---: |",
    `| Начали | **${report.onboardingStarted}** |`,
    `| Ответили на вопрос | **${report.onboardingAnswered}** |`,
    `| Получили доступ | **${report.onboardingAccessGranted}** |`,
    `| Завершили | **${report.onboardingCompleted}** |`,
  ].join("\n");

  const paidWithoutMembershipBlock = report.paidWithoutMembership.length
    ? [
        `**Оплатили, но не вступили · ${report.paidWithoutMembership.length}**`,
        "",
        "| Пользователь | Дата оплаты |",
        "| :--- | ---: |",
        ...report.paidWithoutMembership.map((person) =>
          `| ${personLink(person)} | ${escapeRichMarkdown(`${reportDateFormatter.format(person.paidAt)} (${person.wave})`)} |`,
        ),
      ].join("\n")
    : [
        "**Оплатили, но не вступили · 0**",
        "",
        "Все оплатившие вступили в клуб ✅",
      ].join("\n");

  return [
    [
      "**Продажи**",
      "",
      `**Период:** с ${escapeRichMarkdown(reportDateFormatter.format(report.startedAt))}`,
    ].join("\n"),
    salesTable,
    ["**Онбординг после оплаты**", "", onboardingTable].join("\n"),
    paidWithoutMembershipBlock,
  ].join("\n\n\u2800\n\n");
}

async function loadSalesReport(): Promise<SalesReport | null> {
  const campaignEvents = await prisma.clubEvent.findMany({
    where: {
      eventType: { startsWith: SALES_CAMPAIGN_EVENT_PREFIX },
      OR: SALES_CAMPAIGNS.map((campaign) => ({
        payload: { path: ["campaign"], equals: campaign.id },
      })),
    },
    select: {
      eventType: true,
      targetUserTelegramId: true,
      occurredAt: true,
      payload: true,
    },
    orderBy: { occurredAt: "asc" },
  });
  const startedAt = campaignEvents.at(0)?.occurredAt;
  if (!startedAt) return null;

  const cohortByTelegramId = new Map<string, SalesCohortEntry>();
  for (const event of campaignEvents) {
    if (event.eventType !== "waitlist_broadcast_sent" || event.targetUserTelegramId === null) continue;
    const telegramId = String(event.targetUserTelegramId);
    if (EXCLUDED_SALES_USER_IDS.has(telegramId)) continue;
    const campaign = campaignFromPayload(event.payload);
    const wave = SALES_CAMPAIGNS.find((item) => item.id === campaign)?.wave;
    if (wave && !cohortByTelegramId.has(telegramId)) {
      cohortByTelegramId.set(telegramId, {
        telegramId: event.targetUserTelegramId,
        enteredAt: event.occurredAt,
        wave,
      });
    }
  }
  const deliveredUserIds = new Set(cohortByTelegramId.keys());

  const wave5Entries = await prisma.clubInterest.findMany({
    where: { openedAt: { gt: SALES_WAVE5_STARTED_AT } },
    select: {
      openedAt: true,
      user: { select: { telegramId: true } },
    },
    orderBy: { openedAt: "asc" },
  });
  for (const entry of wave5Entries) {
    const telegramId = String(entry.user.telegramId);
    if (EXCLUDED_SALES_USER_IDS.has(telegramId) || cohortByTelegramId.has(telegramId)) continue;
    cohortByTelegramId.set(telegramId, {
      telegramId: entry.user.telegramId,
      enteredAt: entry.openedAt,
      wave: "волна 5",
    });
  }

  const cohortEntries = [...cohortByTelegramId.values()];
  const cohortTelegramIds = cohortEntries.map((entry) => entry.telegramId);

  const funnel = await loadClubniFunnel(cohortEntries);

  const paymentEvents = await prisma.clubEvent.findMany({
    where: {
      eventType: PAYMENT_EVENT,
      occurredAt: { gte: startedAt },
      targetUserTelegramId: { in: cohortTelegramIds },
      payload: { path: ["clubId"], equals: config.clubniPayment.clubId },
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
    const cohortEntry = cohortByTelegramId.get(key);
    if (!cohortEntry || payment.occurredAt < cohortEntry.enteredAt) continue;
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
      const wave = cohortByTelegramId.get(String(payment.telegramId))?.wave;
      if (!wave) throw new Error(`Sales wave is missing for Telegram ID ${payment.telegramId}`);
      return {
        telegramId: payment.telegramId,
        username: user?.username ?? null,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        paidAt: payment.paidAt,
        wave,
      };
    });

  return {
    startedAt,
    delivered: deliveredUserIds.size,
    cohort: cohortEntries.length,
    notAuthorized: funnel.notAuthorized,
    authorizedNotStarted: funnel.authorizedNotStarted,
    pending: funnel.pending,
    paid: firstPaymentByUser.size,
    paidAndJoined: firstPaymentByUser.size - paidWithoutMembership.length,
    paidWithoutMembership,
    onboardingStarted: countUsersByEvent(onboardingEvents, "clubni_onboarding_intro"),
    onboardingAnswered: countUsersByEvent(onboardingEvents, "clubni_onboarding_answer"),
    onboardingAccessGranted: countUsersByEvent(onboardingEvents, "clubni_onboarding_access"),
    onboardingCompleted: countUsersByEvent(onboardingEvents, "clubni_onboarding_final"),
  };
}

async function loadClubniFunnel(entries: SalesCohortEntry[]) {
  if (!config.clubniSalesReport.enabled || !config.clubniPayment.clubId) {
    throw new Error("Clubni sales report integration is not configured");
  }
  const response = await fetch(config.clubniSalesReport.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.clubniSalesReport.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clubId: config.clubniPayment.clubId,
      cohort: entries.map((entry) => ({
        telegramUserId: String(entry.telegramId),
        enteredAt: entry.enteredAt.toISOString(),
      })),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Clubni sales report returned ${response.status}`);
  }
  const funnel = clubniFunnelSchema.parse(await response.json());
  if (funnel.cohort !== entries.length) {
    throw new Error("Clubni sales report cohort does not match MozhnoBot cohort");
  }
  return funnel;
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

  let report: SalesReport | null;
  try {
    report = await loadSalesReport();
  } catch (error) {
    logger.error("Failed to build sales report", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Не удалось получить данные Clubni. Повторите команду позже.");
    return;
  }
  if (!report) {
    await sendRichReport(ctx, "# Продажи\n\nДанные о кампании рассылки пока отсутствуют\\.");
    return;
  }

  await sendRichReport(ctx, buildSalesReportMarkdown(report));
}
