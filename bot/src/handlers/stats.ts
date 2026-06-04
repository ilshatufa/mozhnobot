import { prisma } from "../database.js";
import { config } from "../config.js";
import { type AuthContext } from "../middlewares/auth.js";

const STATS_WINDOW_DAYS = 7;

function formatUserLabel(user: { telegramId: bigint; username: string | null; firstName: string | null }): string {
  if (user.username) return `@${user.username}`;
  if (user.firstName) return `${user.firstName} (${user.telegramId})`;
  return `${user.telegramId}`;
}

function formatCountLine(label: string, value: number): string {
  return `${label}: ${value}`;
}

function formatTopicLabel(topic: { name: string | null } | undefined, threadId: number | null): string {
  if (!threadId) return "без подтемы";
  return topic?.name ?? "подтема без названия";
}

export async function statsHandler(ctx: AuthContext): Promise<void> {
  const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    newMembers,
    leftMembers,
    removedMembers,
    messages,
    reactions,
    replies,
    activeGroups,
    topMessageUsers,
    topTopics,
    recentJoinedUsers,
  ] = await Promise.all([
    prisma.clubEvent.count({
      where: { eventType: "member_joined", occurredAt: { gte: since } },
    }),
    prisma.clubEvent.count({
      where: { eventType: "member_left", occurredAt: { gte: since } },
    }),
    prisma.clubEvent.count({
      where: { eventType: "member_removed", occurredAt: { gte: since } },
    }),
    prisma.clubEvent.count({
      where: { eventType: "message_created", occurredAt: { gte: since } },
    }),
    prisma.clubEvent.count({
      where: { eventType: "reaction_changed", occurredAt: { gte: since } },
    }),
    prisma.clubEvent.count({
      where: { eventType: "message_reply_created", occurredAt: { gte: since } },
    }),
    prisma.clubEvent.groupBy({
      by: ["userTelegramId"],
      where: {
        occurredAt: { gte: since },
        userTelegramId: { not: null },
        eventType: { in: ["message_created", "reaction_changed", "callback_clicked"] },
      },
    }),
    prisma.clubEvent.groupBy({
      by: ["userTelegramId"],
      where: {
        eventType: "message_created",
        occurredAt: { gte: since },
        userTelegramId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { userTelegramId: "desc" } },
      take: 5,
    }),
    prisma.clubEvent.groupBy({
      by: ["telegramMessageThreadId"],
      where: {
        eventType: "message_created",
        occurredAt: { gte: since },
      },
      _count: { _all: true },
      orderBy: { _count: { telegramMessageThreadId: "desc" } },
      take: 5,
    }),
    prisma.user.findMany({
      where: {
        joinedAt: { gte: since },
        clubStatus: "MEMBER",
      },
      select: {
        telegramId: true,
        username: true,
        firstName: true,
      },
      take: 50,
      orderBy: { joinedAt: "desc" },
    }),
  ]);

  const topUserIds = topMessageUsers
    .map((item) => item.userTelegramId)
    .filter((telegramId): telegramId is bigint => telegramId !== null);
  const topUsers = await prisma.user.findMany({
    where: { telegramId: { in: topUserIds } },
    select: { telegramId: true, username: true, firstName: true },
  });
  const usersByTelegramId = new Map(topUsers.map((user) => [user.telegramId.toString(), user]));

  const topicIds = topTopics
    .map((item) => item.telegramMessageThreadId)
    .filter((threadId): threadId is number => threadId !== null);
  const topics = await prisma.clubTopic.findMany({
    where: {
      chatTelegramId: BigInt(config.clubGroupId),
      telegramMessageThreadId: { in: topicIds },
    },
  });
  const topicsByThreadId = new Map(topics.map((topic) => [topic.telegramMessageThreadId, topic]));

  const recentJoinedIds = recentJoinedUsers.map((user) => user.telegramId);
  const activeRecentJoined = recentJoinedIds.length
    ? await prisma.clubEvent.groupBy({
        by: ["userTelegramId"],
        where: {
          userTelegramId: { in: recentJoinedIds },
          eventType: { in: ["message_created", "reaction_changed", "callback_clicked"] },
          occurredAt: { gte: since },
        },
      })
    : [];
  const activeRecentJoinedIds = new Set(
    activeRecentJoined
      .map((item) => item.userTelegramId)
      .filter((telegramId): telegramId is bigint => telegramId !== null)
      .map((telegramId) => telegramId.toString()),
  );
  const inactiveJoinedUsers = recentJoinedUsers
    .filter((user) => !activeRecentJoinedIds.has(user.telegramId.toString()))
    .slice(0, 5);

  const topUserLines = topMessageUsers.map((item, index) => {
    if (!item.userTelegramId) return `${index + 1}. неизвестный пользователь: ${item._count._all}`;
    const user = usersByTelegramId.get(item.userTelegramId.toString());
    const label = user ? formatUserLabel(user) : `${item.userTelegramId}`;
    return `${index + 1}. ${label}: ${item._count._all}`;
  });

  const topTopicLines = topTopics.map((item, index) => {
    const topic = item.telegramMessageThreadId
      ? topicsByThreadId.get(item.telegramMessageThreadId)
      : null;
    const label = formatTopicLabel(topic ?? undefined, item.telegramMessageThreadId);
    return `${index + 1}. ${label}: ${item._count._all}`;
  });

  const inactiveLines = inactiveJoinedUsers.map((user, index) => `${index + 1}. ${formatUserLabel(user)}`);

  const lines = [
    `Статистика клуба за ${STATS_WINDOW_DAYS} дней`,
    "",
    formatCountLine("Новые участники", newMembers),
    formatCountLine("Вышли", leftMembers),
    formatCountLine("Удалены", removedMembers),
    formatCountLine("Активные участники", activeGroups.length),
    formatCountLine("Сообщения", messages),
    formatCountLine("Реакции", reactions),
    formatCountLine("Ответы участник-участнику", replies),
    "",
    "Топ участников по сообщениям:",
    ...(topUserLines.length ? topUserLines : ["нет данных"]),
    "",
    "Топ подтем по сообщениям:",
    ...(topTopicLines.length ? topTopicLines : ["нет данных"]),
    "",
    "Вступили, но не сделали действий:",
    ...(inactiveLines.length ? inactiveLines : ["нет данных"]),
  ];

  await ctx.reply(lines.join("\n"));
}
