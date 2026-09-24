import { BotInteractionStatus, Prisma } from "@prisma/client";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Telegram } from "telegraf";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { userRepository } from "../repositories/user.repository.js";
import { isBotBlockedError } from "../telegram-errors.js";

const CAMPAIGN = "waitlist-sales-2026-09";
const LOG_PATH = process.env.BROADCAST_LOG_PATH ?? "/app/media/waitlist-broadcast-2026-09-24.log";
const SEND_INTERVAL_MS = 125;

const MESSAGE = `Привет! Спасибо, что ты здесь и что ждешь окошка в клуб «МОЖНО»🤗 Мы сейчас работаем над платежными нюансами, чтобы всё работало максимально четко🔥 

Сигнал о старте продаж придет здесь, в боте – поэтому пожалуйста, не удаляй его, и не ставь на беззвучку) 

И не переживай, каждый, кто хочет зайти - обязательно получит шанс 👌 

А пока МОЖНО:
- начать расхламляться по нашей методичке Авито (на кладовые потом деньги ой как понадобятся) 
- начинать считать доходы и расходы (по той же причине😁)
- и ловить теплые сентябрьские деньки))`;

type DeliveryStatus = "PENDING" | "SENDING" | "SENT" | "BLOCKED" | "FAILED";

type Recipient = {
  telegramId: bigint;
  username: string | null;
  waitlistedAt: Date;
  botStatus: BotInteractionStatus;
};

type DeliveryState = {
  status: DeliveryStatus;
  messageId?: number;
  updatedAt?: Date;
  detail?: string;
};

type TelegramErrorDetails = {
  code: number | null;
  description: string;
  retryAfterSeconds: number | null;
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function eventKey(telegramId: bigint, outcome: "sent" | "blocked"): string {
  return `${CAMPAIGN}:${telegramId}:${outcome}`;
}

function errorDetails(error: unknown): TelegramErrorDetails {
  if (!error || typeof error !== "object") {
    return { code: null, description: String(error), retryAfterSeconds: null };
  }

  const value = error as {
    code?: unknown;
    description?: unknown;
    response?: {
      error_code?: unknown;
      description?: unknown;
      parameters?: { retry_after?: unknown };
    };
  };
  const code =
    typeof value.response?.error_code === "number"
      ? value.response.error_code
      : typeof value.code === "number"
        ? value.code
        : null;
  const description =
    typeof value.response?.description === "string"
      ? value.response.description
      : typeof value.description === "string"
        ? value.description
        : String(error);
  const retryAfterSeconds =
    typeof value.response?.parameters?.retry_after === "number"
      ? value.response.parameters.retry_after
      : null;

  return { code, description, retryAfterSeconds };
}

function safeLogValue(value: string | null | undefined): string {
  return (value ?? "").replace(/[\t\r\n]/g, " ");
}

async function writeStatusLog(
  recipients: Recipient[],
  states: Map<string, DeliveryState>,
): Promise<void> {
  const counts: Record<DeliveryStatus, number> = {
    PENDING: 0,
    SENDING: 0,
    SENT: 0,
    BLOCKED: 0,
    FAILED: 0,
  };
  const rows = recipients.map((recipient) => {
    const state = states.get(String(recipient.telegramId)) ?? { status: "PENDING" as const };
    counts[state.status] += 1;
    return [
      state.status,
      String(recipient.telegramId),
      recipient.username ? `@${recipient.username}` : "",
      recipient.waitlistedAt.toISOString(),
      state.messageId?.toString() ?? "",
      state.updatedAt?.toISOString() ?? "",
      safeLogValue(state.detail),
    ].join("\t");
  });
  const header = [
    `CAMPAIGN\t${CAMPAIGN}`,
    `UPDATED_AT\t${new Date().toISOString()}`,
    `TOTAL\t${recipients.length}`,
    `COUNTS\tPENDING=${counts.PENDING}\tSENDING=${counts.SENDING}\tSENT=${counts.SENT}\tBLOCKED=${counts.BLOCKED}\tFAILED=${counts.FAILED}`,
    "STATUS\tTELEGRAM_ID\tUSERNAME\tWAITLISTED_AT\tMESSAGE_ID\tUPDATED_AT\tDETAIL",
  ];
  const temporaryPath = `${LOG_PATH}.tmp`;
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await writeFile(temporaryPath, `${[...header, ...rows].join("\n")}\n`, "utf8");
  await rename(temporaryPath, LOG_PATH);
}

async function createEvent(
  recipient: Recipient,
  outcome: "sent" | "blocked",
  eventType: string,
  payload?: Prisma.InputJsonValue,
): Promise<boolean> {
  try {
    await prisma.clubEvent.create({
      data: {
        dedupeKey: eventKey(recipient.telegramId, outcome),
        eventType,
        userTelegramId: recipient.telegramId,
        targetUserTelegramId: recipient.telegramId,
        occurredAt: new Date(),
        payload,
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

async function recordStarted(recipient: Recipient): Promise<void> {
  await prisma.clubEvent.create({
    data: {
      dedupeKey: `${CAMPAIGN}:${recipient.telegramId}:started:${Date.now()}`,
      eventType: "waitlist_broadcast_started",
      userTelegramId: recipient.telegramId,
      targetUserTelegramId: recipient.telegramId,
      occurredAt: new Date(),
      payload: { campaign: CAMPAIGN },
    },
  });
}

async function recordFailure(recipient: Recipient, error: TelegramErrorDetails): Promise<void> {
  await prisma.clubEvent.create({
    data: {
      dedupeKey: `${CAMPAIGN}:${recipient.telegramId}:failed:${Date.now()}`,
      eventType: "waitlist_broadcast_failed",
      userTelegramId: recipient.telegramId,
      targetUserTelegramId: recipient.telegramId,
      occurredAt: new Date(),
      payload: {
        campaign: CAMPAIGN,
        code: error.code ?? "unknown",
        description: error.description,
      },
    },
  });
}

async function sendWithRetry(telegram: Telegram, telegramId: bigint): Promise<{ message_id: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await telegram.sendMessage(String(telegramId), MESSAGE);
    } catch (error) {
      if (isBotBlockedError(error)) throw error;
      lastError = error;
      const details = errorDetails(error);
      if (attempt === 3) break;
      const retryDelayMs = details.retryAfterSeconds
        ? (details.retryAfterSeconds + 1) * 1000
        : attempt * 2000;
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const interests = await prisma.clubInterest.findMany({
    where: { waitlistedAt: { not: null } },
    select: {
      waitlistedAt: true,
      user: {
        select: {
          telegramId: true,
          username: true,
          botStatus: true,
        },
      },
    },
    orderBy: { waitlistedAt: "asc" },
  });
  const recipients: Recipient[] = interests.map((interest) => ({
    telegramId: interest.user.telegramId,
    username: interest.user.username,
    waitlistedAt: interest.waitlistedAt!,
    botStatus: interest.user.botStatus,
  }));

  const events = await prisma.clubEvent.findMany({
    where: { dedupeKey: { startsWith: `${CAMPAIGN}:` } },
    orderBy: { occurredAt: "asc" },
  });
  const states = new Map<string, DeliveryState>();
  for (const recipient of recipients) {
    if (recipient.botStatus === BotInteractionStatus.BLOCKED) {
      states.set(String(recipient.telegramId), {
        status: "BLOCKED",
        detail: "bot_status=BLOCKED before campaign",
      });
    }
  }
  for (const event of events) {
    if (!event.targetUserTelegramId) continue;
    const telegramId = String(event.targetUserTelegramId);
    if (event.eventType === "waitlist_broadcast_started") {
      const current = states.get(telegramId);
      if (!current || (current.status !== "SENT" && current.status !== "BLOCKED")) {
        states.set(telegramId, {
          status: "SENDING",
          updatedAt: event.occurredAt,
          detail: "send started; rerun does not duplicate an uncertain delivery",
        });
      }
    } else if (event.eventType === "waitlist_broadcast_sent") {
      const payload = event.payload as { messageId?: unknown } | null;
      states.set(telegramId, {
        status: "SENT",
        messageId: typeof payload?.messageId === "number" ? payload.messageId : undefined,
        updatedAt: event.occurredAt,
      });
    } else if (event.eventType === "waitlist_broadcast_blocked") {
      states.set(telegramId, {
        status: "BLOCKED",
        updatedAt: event.occurredAt,
        detail: "Telegram: bot was blocked by the user",
      });
    } else if (event.eventType === "waitlist_broadcast_failed") {
      const current = states.get(telegramId);
      if (!current || (current.status !== "SENT" && current.status !== "BLOCKED")) {
        const payload = event.payload as { description?: unknown } | null;
        states.set(telegramId, {
          status: "FAILED",
          updatedAt: event.occurredAt,
          detail: typeof payload?.description === "string" ? payload.description : "send failed",
        });
      }
    }
  }
  for (const recipient of recipients) {
    if (recipient.botStatus === BotInteractionStatus.BLOCKED) {
      states.set(String(recipient.telegramId), {
        status: "BLOCKED",
        detail: "bot_status=BLOCKED before campaign",
      });
    }
  }
  await writeStatusLog(recipients, states);

  const telegram = new Telegram(config.botToken);
  for (const recipient of recipients) {
    const telegramId = String(recipient.telegramId);
    const current = states.get(telegramId);
    if (current?.status === "SENT" || current?.status === "BLOCKED" || current?.status === "SENDING") {
      continue;
    }

    await recordStarted(recipient);
    states.set(telegramId, { status: "SENDING", updatedAt: new Date() });
    await writeStatusLog(recipients, states);

    try {
      const sent = await sendWithRetry(telegram, recipient.telegramId);
      const sentAt = new Date();
      await createEvent(recipient, "sent", "waitlist_broadcast_sent", {
        campaign: CAMPAIGN,
        messageId: sent.message_id,
      });
      states.set(telegramId, {
        status: "SENT",
        messageId: sent.message_id,
        updatedAt: sentAt,
      });
    } catch (error) {
      const details = errorDetails(error);
      const failedAt = new Date();
      if (isBotBlockedError(error)) {
        await userRepository.markBotBlocked(recipient.telegramId, failedAt);
        await createEvent(recipient, "blocked", "waitlist_broadcast_blocked", {
          campaign: CAMPAIGN,
          description: details.description,
        });
        states.set(telegramId, {
          status: "BLOCKED",
          updatedAt: failedAt,
          detail: details.description,
        });
      } else {
        await recordFailure(recipient, details);
        states.set(telegramId, {
          status: "FAILED",
          updatedAt: failedAt,
          detail: details.description,
        });
      }
    }
    await writeStatusLog(recipients, states);
    await sleep(SEND_INTERVAL_MS);
  }

  await writeStatusLog(recipients, states);
  const sent = [...states.values()].filter((state) => state.status === "SENT").length;
  const blocked = [...states.values()].filter((state) => state.status === "BLOCKED").length;
  const failed = [...states.values()].filter((state) => state.status === "FAILED").length;
  const pending = recipients.length - sent - blocked - failed;
  console.log(JSON.stringify({ campaign: CAMPAIGN, total: recipients.length, sent, blocked, failed, pending }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
