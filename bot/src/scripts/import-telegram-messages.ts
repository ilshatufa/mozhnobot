import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../database.js";

type ExportMessage = {
  id: number;
  date: string;
  sender_id?: number | null;
  sender_username?: string | null;
  sender_name?: string | null;
  topic_id?: number | null;
  topic_title?: string | null;
  reply_to?: number | null;
  reply_to_top_id?: number | null;
  message_type?: string | null;
  text?: string | null;
  text_length?: number | null;
  media_type?: string | null;
  media_id?: string | number | null;
  mime_type?: string | null;
  file_name?: string | null;
  file_size?: string | number | null;
  duration?: string | number | null;
  views?: number | null;
  forwards?: number | null;
  edit_date?: string | null;
};

type Summary = {
  dryRun: boolean;
  exportDir: string;
  chatTelegramId: string;
  messages: {
    found: number;
    skippedService: number;
    skippedInvalidDate: number;
    indexCreates: number;
    indexUpdates: number;
    indexUnchanged: number;
  };
  users: {
    creates: number;
    updates: number;
    unchanged: number;
  };
  events: {
    messageCreatedCreates: number;
    messageCreatedExisting: number;
    replyCreates: number;
    replyExisting: number;
  };
  media: {
    found: number;
    creates: number;
    updates: number;
    unchanged: number;
  };
};

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNullableInt(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null;
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function earlierDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function isServiceMessage(message: ExportMessage): boolean {
  return Boolean(message.message_type?.startsWith("MessageAction"));
}

function messageType(message: ExportMessage): string {
  return message.media_type || message.message_type || "text";
}

function actualReplyToMessageId(message: ExportMessage): number | null {
  if (!message.reply_to) return null;
  return message.reply_to === message.topic_id ? null : message.reply_to;
}

function textOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function comparableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Date) return item.toISOString();
    if (typeof item === "bigint") return item.toString();
    return item;
  });
}

function isDifferent(left: unknown, right: unknown): boolean {
  return comparableJson(left) !== comparableJson(right);
}

async function eventExists(eventType: string, chatTelegramId: bigint, messageTelegramId: number): Promise<boolean> {
  const count = await prisma.clubEvent.count({
    where: {
      eventType,
      chatTelegramId,
      messageTelegramId,
    },
  });
  return count > 0;
}

async function upsertSender(
  message: ExportMessage,
  postedAt: Date,
  dryRun: boolean,
  summary: Summary,
): Promise<void> {
  if (!message.sender_id) return;

  const telegramId = BigInt(message.sender_id);
  const existing = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      username: true,
      firstName: true,
      firstSeenAt: true,
      lastSeenAt: true,
      clubStatus: true,
    },
  });

  if (!existing) {
    summary.users.creates += 1;
    if (!dryRun) {
      await prisma.user.create({
        data: {
          telegramId,
          username: message.sender_username ?? null,
          firstName: message.sender_name ?? null,
          clubStatus: "MEMBER",
          firstSeenAt: postedAt,
          lastSeenAt: postedAt,
        },
      });
    }
    return;
  }

  const data: Prisma.UserUpdateInput = {
    username: message.sender_username ?? existing.username,
    firstName: message.sender_name ?? existing.firstName,
    clubStatus: existing.clubStatus === "UNKNOWN" ? "MEMBER" : existing.clubStatus,
    firstSeenAt: earlierDate(existing.firstSeenAt, postedAt),
    lastSeenAt: laterDate(existing.lastSeenAt, postedAt),
  };
  const comparable = {
    username: data.username,
    firstName: data.firstName,
    clubStatus: data.clubStatus,
    firstSeenAt: data.firstSeenAt,
    lastSeenAt: data.lastSeenAt,
  };
  const existingComparable = {
    username: existing.username,
    firstName: existing.firstName,
    clubStatus: existing.clubStatus,
    firstSeenAt: existing.firstSeenAt,
    lastSeenAt: existing.lastSeenAt,
  };

  if (isDifferent(existingComparable, comparable)) {
    summary.users.updates += 1;
    if (!dryRun) {
      await prisma.user.update({ where: { telegramId }, data });
    }
    return;
  }

  summary.users.unchanged += 1;
}

async function upsertMessageIndex(
  chatTelegramId: bigint,
  message: ExportMessage,
  postedAt: Date,
  editedAt: Date | null,
  dryRun: boolean,
  summary: Summary,
): Promise<number | null> {
  const data = {
    chatTelegramId,
    telegramMessageId: message.id,
    telegramMessageThreadId: message.topic_id ?? null,
    authorTelegramId: message.sender_id ? BigInt(message.sender_id) : null,
    replyToTelegramMessageId: actualReplyToMessageId(message),
    messageType: messageType(message),
    text: textOrNull(message.text),
    caption: null,
    textLength: message.text_length ?? message.text?.length ?? null,
    captionLength: null,
    postedAt,
    editedAt,
  };

  const existing = await prisma.clubMessageIndex.findUnique({
    where: {
      chatTelegramId_telegramMessageId: {
        chatTelegramId,
        telegramMessageId: message.id,
      },
    },
  });

  if (!existing) {
    summary.messages.indexCreates += 1;
    if (dryRun) return null;
    const created = await prisma.clubMessageIndex.create({ data });
    return created.id;
  }

  const comparable = {
    chatTelegramId: existing.chatTelegramId,
    telegramMessageId: existing.telegramMessageId,
    telegramMessageThreadId: existing.telegramMessageThreadId,
    authorTelegramId: existing.authorTelegramId,
    replyToTelegramMessageId: existing.replyToTelegramMessageId,
    messageType: existing.messageType,
    text: existing.text,
    caption: existing.caption,
    textLength: existing.textLength,
    captionLength: existing.captionLength,
    postedAt: existing.postedAt,
    editedAt: existing.editedAt,
  };

  if (isDifferent(comparable, data)) {
    summary.messages.indexUpdates += 1;
    if (!dryRun) {
      await prisma.clubMessageIndex.update({
        where: { id: existing.id },
        data,
      });
    }
    return existing.id;
  }

  summary.messages.indexUnchanged += 1;
  return existing.id;
}

async function createMessageEvent(
  chatTelegramId: bigint,
  message: ExportMessage,
  postedAt: Date,
  dryRun: boolean,
  summary: Summary,
): Promise<void> {
  if (await eventExists("message_created", chatTelegramId, message.id)) {
    summary.events.messageCreatedExisting += 1;
    return;
  }

  summary.events.messageCreatedCreates += 1;
  if (dryRun) return;

  await prisma.clubEvent.create({
    data: {
      dedupeKey: `import:${chatTelegramId}:${message.id}:message_created`,
      eventType: "message_created",
      chatTelegramId,
      telegramMessageThreadId: message.topic_id ?? null,
      userTelegramId: message.sender_id ? BigInt(message.sender_id) : null,
      messageTelegramId: message.id,
      occurredAt: postedAt,
      payload: asJson({
        source: "telegram_export",
        messageType: messageType(message),
        topicTitle: message.topic_title || null,
        hasText: Boolean(message.text),
        textLength: message.text_length ?? message.text?.length ?? null,
        hasMedia: Boolean(message.media_type),
        mediaType: message.media_type || null,
        views: message.views ?? null,
        forwards: message.forwards ?? null,
      }),
    },
  });
}

async function createReplyEvent(
  chatTelegramId: bigint,
  message: ExportMessage,
  postedAt: Date,
  dryRun: boolean,
  summary: Summary,
): Promise<void> {
  const replyToMessageId = actualReplyToMessageId(message);
  if (!replyToMessageId) return;

  if (await eventExists("message_reply_created", chatTelegramId, message.id)) {
    summary.events.replyExisting += 1;
    return;
  }

  const targetMessage = await prisma.clubMessageIndex.findUnique({
    where: {
      chatTelegramId_telegramMessageId: {
        chatTelegramId,
        telegramMessageId: replyToMessageId,
      },
    },
    select: { authorTelegramId: true },
  });

  summary.events.replyCreates += 1;
  if (dryRun) return;

  await prisma.clubEvent.create({
    data: {
      dedupeKey: `import:${chatTelegramId}:${message.id}:message_reply_created`,
      eventType: "message_reply_created",
      chatTelegramId,
      telegramMessageThreadId: message.topic_id ?? null,
      userTelegramId: message.sender_id ? BigInt(message.sender_id) : null,
      messageTelegramId: message.id,
      targetUserTelegramId: targetMessage?.authorTelegramId ?? null,
      targetMessageTelegramId: replyToMessageId,
      occurredAt: postedAt,
      payload: asJson({
        source: "telegram_export",
        replyToTopId: message.reply_to_top_id ?? null,
      }),
    },
  });
}

async function upsertMedia(
  chatTelegramId: bigint,
  message: ExportMessage,
  messageIndexId: number | null,
  dryRun: boolean,
  summary: Summary,
): Promise<void> {
  if (!message.media_type || !message.media_id) return;
  summary.media.found += 1;

  const existing = await prisma.clubMedia.findUnique({
    where: {
      chatTelegramId_telegramMessageId_mediaType: {
        chatTelegramId,
        telegramMessageId: message.id,
        mediaType: message.media_type,
      },
    },
  });

  if (!messageIndexId) {
    if (existing) {
      summary.media.unchanged += 1;
    } else {
      summary.media.creates += 1;
    }
    return;
  }

  const data = {
    messageIndexId,
    chatTelegramId,
    telegramMessageId: message.id,
    mediaType: message.media_type,
    telegramFileId: String(message.media_id),
    telegramFileUniqueId: null,
    durationSeconds: parseNullableInt(message.duration),
    fileSize: parseNullableInt(message.file_size),
    mimeType: textOrNull(message.mime_type),
    title: textOrNull(message.file_name),
    performer: null,
  };

  if (!existing) {
    summary.media.creates += 1;
    if (!dryRun) {
      await prisma.clubMedia.create({ data });
    }
    return;
  }

  const comparable = {
    messageIndexId: existing.messageIndexId,
    chatTelegramId: existing.chatTelegramId,
    telegramMessageId: existing.telegramMessageId,
    mediaType: existing.mediaType,
    telegramFileId: existing.telegramFileId,
    telegramFileUniqueId: existing.telegramFileUniqueId,
    durationSeconds: existing.durationSeconds,
    fileSize: existing.fileSize,
    mimeType: existing.mimeType,
    title: existing.title,
    performer: existing.performer,
  };

  if (isDifferent(comparable, data)) {
    summary.media.updates += 1;
    if (!dryRun) {
      await prisma.clubMedia.update({
        where: { id: existing.id },
        data,
      });
    }
    return;
  }

  summary.media.unchanged += 1;
}

async function main(): Promise<void> {
  const exportDir = process.env.TELEGRAM_EXPORT_DIR;
  if (!exportDir) {
    throw new Error("TELEGRAM_EXPORT_DIR is required");
  }

  const dryRun = parseBool(process.env.IMPORT_DRY_RUN, true);
  const chatTelegramId = BigInt(process.env.TELEGRAM_EXPORT_CHAT_ID ?? "-1003393970920");
  const filePath = path.join(exportDir, "messages.jsonl");

  const summary: Summary = {
    dryRun,
    exportDir,
    chatTelegramId: chatTelegramId.toString(),
    messages: {
      found: 0,
      skippedService: 0,
      skippedInvalidDate: 0,
      indexCreates: 0,
      indexUpdates: 0,
      indexUnchanged: 0,
    },
    users: {
      creates: 0,
      updates: 0,
      unchanged: 0,
    },
    events: {
      messageCreatedCreates: 0,
      messageCreatedExisting: 0,
      replyCreates: 0,
      replyExisting: 0,
    },
    media: {
      found: 0,
      creates: 0,
      updates: 0,
      unchanged: 0,
    },
  };

  const input = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of input) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as ExportMessage;
    summary.messages.found += 1;

    if (isServiceMessage(message)) {
      summary.messages.skippedService += 1;
      continue;
    }

    const postedAt = parseDate(message.date);
    if (!postedAt) {
      summary.messages.skippedInvalidDate += 1;
      continue;
    }
    const editedAt = parseDate(message.edit_date);

    await upsertSender(message, postedAt, dryRun, summary);
    const messageIndexId = await upsertMessageIndex(chatTelegramId, message, postedAt, editedAt, dryRun, summary);
    await createMessageEvent(chatTelegramId, message, postedAt, dryRun, summary);
    await createReplyEvent(chatTelegramId, message, postedAt, dryRun, summary);
    await upsertMedia(chatTelegramId, message, messageIndexId, dryRun, summary);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
