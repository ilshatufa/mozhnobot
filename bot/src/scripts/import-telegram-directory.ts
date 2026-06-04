import { readFile } from "node:fs/promises";
import path from "node:path";
import { ClubMembershipStatus, ClubTopicStatus, Prisma } from "@prisma/client";
import { prisma } from "../database.js";

type ExportTopic = {
  id: number;
  title?: string | null;
  closed?: boolean;
  hidden?: boolean;
};

type TopicsExport = {
  chat: {
    telegram_id: number;
    title?: string;
  };
  topics: ExportTopic[];
};

type ExportUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  bot?: boolean;
  participant?: {
    date?: string | null;
  } | null;
  analytics?: {
    first_message_at?: string | null;
    last_message_at?: string | null;
  } | null;
};

type UsersExport = {
  chat: {
    telegram_id: number;
    title?: string;
  };
  users: ExportUser[];
};

type Summary = {
  dryRun: boolean;
  exportDir: string;
  chatTelegramId: string;
  topics: {
    found: number;
    creates: number;
    updates: number;
    unchanged: number;
  };
  users: {
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

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function topicStatus(topic: ExportTopic): ClubTopicStatus {
  if (topic.hidden) return ClubTopicStatus.HIDDEN;
  if (topic.closed) return ClubTopicStatus.CLOSED;
  return ClubTopicStatus.ACTIVE;
}

function userClubStatus(user: ExportUser): ClubMembershipStatus {
  return user.participant ? ClubMembershipStatus.MEMBER : ClubMembershipStatus.UNKNOWN;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function isDifferent<T>(left: T, right: T): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

async function importTopics(
  chatTelegramId: bigint,
  topics: ExportTopic[],
  dryRun: boolean,
): Promise<Summary["topics"]> {
  const summary = {
    found: topics.length,
    creates: 0,
    updates: 0,
    unchanged: 0,
  };

  for (const topic of topics) {
    const data = {
      name: topic.title ?? null,
      status: topicStatus(topic),
    };

    const existing = await prisma.clubTopic.findUnique({
      where: {
        chatTelegramId_telegramMessageThreadId: {
          chatTelegramId,
          telegramMessageThreadId: topic.id,
        },
      },
      select: { name: true, status: true },
    });

    if (!existing) {
      summary.creates += 1;
      if (!dryRun) {
        await prisma.clubTopic.create({
          data: {
            chatTelegramId,
            telegramMessageThreadId: topic.id,
            ...data,
          },
        });
      }
      continue;
    }

    if (isDifferent(existing, data)) {
      summary.updates += 1;
      if (!dryRun) {
        await prisma.clubTopic.update({
          where: {
            chatTelegramId_telegramMessageThreadId: {
              chatTelegramId,
              telegramMessageThreadId: topic.id,
            },
          },
          data,
        });
      }
      continue;
    }

    summary.unchanged += 1;
  }

  return summary;
}

async function importUsers(users: ExportUser[], dryRun: boolean): Promise<Summary["users"]> {
  const summary = {
    found: users.length,
    creates: 0,
    updates: 0,
    unchanged: 0,
  };

  for (const exportUser of users) {
    const telegramId = BigInt(exportUser.id);
    const firstMessageAt = parseDate(exportUser.analytics?.first_message_at);
    const lastMessageAt = parseDate(exportUser.analytics?.last_message_at);
    const joinedAt = parseDate(exportUser.participant?.date);
    const clubStatus = userClubStatus(exportUser);

    const existing = await prisma.user.findUnique({
      where: { telegramId },
      select: {
        username: true,
        firstName: true,
        lastName: true,
        isBot: true,
        clubStatus: true,
        joinedAt: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });

    if (!existing) {
      summary.creates += 1;
      if (!dryRun) {
        await prisma.user.create({
          data: {
            telegramId,
            username: exportUser.username ?? null,
            firstName: exportUser.first_name ?? null,
            lastName: exportUser.last_name ?? null,
            isBot: exportUser.bot ?? false,
            clubStatus,
            joinedAt,
            firstSeenAt: firstMessageAt,
            lastSeenAt: lastMessageAt,
          },
        });
      }
      continue;
    }

    const data: Prisma.UserUpdateInput = {
      username: exportUser.username ?? null,
      firstName: exportUser.first_name ?? null,
      lastName: exportUser.last_name ?? null,
      isBot: exportUser.bot ?? false,
      clubStatus,
      joinedAt: existing.joinedAt ?? joinedAt,
      firstSeenAt: existing.firstSeenAt ?? firstMessageAt,
      lastSeenAt: laterDate(existing.lastSeenAt, lastMessageAt),
    };

    const comparable = {
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      isBot: data.isBot,
      clubStatus: data.clubStatus,
      joinedAt: data.joinedAt,
      firstSeenAt: data.firstSeenAt,
      lastSeenAt: data.lastSeenAt,
    };

    if (isDifferent(existing, comparable)) {
      summary.updates += 1;
      if (!dryRun) {
        await prisma.user.update({
          where: { telegramId },
          data,
        });
      }
      continue;
    }

    summary.unchanged += 1;
  }

  return summary;
}

async function main(): Promise<void> {
  const exportDir = process.env.TELEGRAM_EXPORT_DIR;
  if (!exportDir) {
    throw new Error("TELEGRAM_EXPORT_DIR is required");
  }

  const dryRun = parseBool(process.env.IMPORT_DRY_RUN, true);
  const topicsExport = await readJson<TopicsExport>(path.join(exportDir, "topics_full_metadata.json"));
  const usersExport = await readJson<UsersExport>(path.join(exportDir, "users_full_metadata.json"));

  if (topicsExport.chat.telegram_id !== usersExport.chat.telegram_id) {
    throw new Error("Topic and user exports belong to different chats");
  }

  const chatTelegramId = BigInt(topicsExport.chat.telegram_id);
  const summary: Summary = {
    dryRun,
    exportDir,
    chatTelegramId: chatTelegramId.toString(),
    topics: await importTopics(chatTelegramId, topicsExport.topics, dryRun),
    users: await importUsers(usersExport.users, dryRun),
  };

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
