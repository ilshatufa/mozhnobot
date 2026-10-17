import { ClubMembershipStatus } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChatMember = {
  status: string;
  user: TelegramUser;
  is_member?: boolean;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);

class TelegramApiError extends Error {
  constructor(
    readonly errorCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapClubStatus(member: TelegramChatMember): ClubMembershipStatus {
  if (MEMBER_STATUSES.has(member.status)) return ClubMembershipStatus.MEMBER;
  if (member.status === "restricted") {
    return member.is_member ? ClubMembershipStatus.MEMBER : ClubMembershipStatus.LEFT;
  }
  if (member.status === "left") return ClubMembershipStatus.LEFT;
  if (member.status === "kicked") return ClubMembershipStatus.REMOVED;
  return ClubMembershipStatus.UNKNOWN;
}

async function telegramGet<T>(method: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`https://api.telegram.org/bot${config.botToken}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url);
  const json = await response.json() as TelegramApiResponse<T>;
  if (!json.ok || json.result === undefined) {
    throw new TelegramApiError(
      json.error_code,
      json.description ?? `Telegram ${method} failed with HTTP ${response.status}`,
    );
  }

  return json.result;
}

function requestedTelegramIds(args: string[]): bigint[] | null {
  if (args.length === 0) return null;

  const ids = new Set<string>();
  for (const value of args) {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Invalid Telegram user id: ${value}`);
    }
    ids.add(value);
  }

  return [...ids].map((id) => BigInt(id));
}

function parseArguments(args: string[]): { dryRun: boolean; requestedIds: bigint[] | null } {
  const dryRun = args.includes("--dry-run");
  return {
    dryRun,
    requestedIds: requestedTelegramIds(args.filter((value) => value !== "--dry-run")),
  };
}

async function collectKnownTelegramIds(): Promise<bigint[]> {
  const [users, messageAuthors, eventUsers, eventTargetUsers] = await Promise.all([
    prisma.user.findMany({ select: { telegramId: true } }),
    prisma.clubMessageIndex.findMany({
      where: { authorTelegramId: { not: null } },
      select: { authorTelegramId: true },
      distinct: ["authorTelegramId"],
    }),
    prisma.clubEvent.findMany({
      where: { userTelegramId: { not: null } },
      select: { userTelegramId: true },
      distinct: ["userTelegramId"],
    }),
    prisma.clubEvent.findMany({
      where: { targetUserTelegramId: { not: null } },
      select: { targetUserTelegramId: true },
      distinct: ["targetUserTelegramId"],
    }),
  ]);

  const ids = new Set<string>();
  for (const user of users) ids.add(user.telegramId.toString());
  for (const message of messageAuthors) {
    if (message.authorTelegramId) ids.add(message.authorTelegramId.toString());
  }
  for (const event of eventUsers) {
    if (event.userTelegramId) ids.add(event.userTelegramId.toString());
  }
  for (const event of eventTargetUsers) {
    if (event.targetUserTelegramId) ids.add(event.targetUserTelegramId.toString());
  }

  return [...ids].map((id) => BigInt(id));
}

async function syncUser(
  telegramId: bigint,
  dryRun: boolean,
): Promise<{ status: "updated" | "not_found" | "failed"; reason?: string }> {
  try {
    const member = await telegramGet<TelegramChatMember>("getChatMember", {
      chat_id: config.clubGroupId,
      user_id: telegramId.toString(),
    });

    const user = member.user;
    const clubStatus = mapClubStatus(member);

    if (!dryRun) {
      await prisma.user.upsert({
        where: { telegramId },
        update: {
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          isBot: user.is_bot ?? false,
          clubStatus,
        },
        create: {
          telegramId,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          isBot: user.is_bot ?? false,
          clubStatus,
        },
      });
    }

    return { status: "updated" };
  } catch (error) {
    if (
      error instanceof TelegramApiError &&
      error.errorCode === 400 &&
      error.message === "Bad Request: member not found"
    ) {
      if (!dryRun) {
        await prisma.user.updateMany({
          where: { telegramId },
          data: { clubStatus: ClubMembershipStatus.UNKNOWN },
        });
      }
      return { status: "not_found" };
    }

    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const { dryRun, requestedIds } = parseArguments(process.argv.slice(2));
  const ids = requestedIds ?? await collectKnownTelegramIds();
  const summary = {
    scope: requestedIds ? "requested" : "all_known",
    dryRun,
    knownIds: ids.length,
    updated: 0,
    notFoundMarkedUnknown: 0,
    failed: 0,
    failures: [] as Array<{ telegramId: string; reason: string }>,
  };

  for (const telegramId of ids) {
    const result = await syncUser(telegramId, dryRun);
    if (result.status === "updated") {
      summary.updated += 1;
    } else if (result.status === "not_found") {
      summary.notFoundMarkedUnknown += 1;
    } else {
      summary.failed += 1;
      summary.failures.push({
        telegramId: telegramId.toString(),
        reason: result.reason ?? "Unknown error",
      });
    }

    await sleep(50);
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
