import { BotInteractionStatus, ClubMembershipStatus, Role, type User } from "@prisma/client";
import { prisma } from "../database.js";

type TelegramUserInput = {
  id: number | bigint;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
};

export class UserRepository {
  async findByTelegramId(telegramId: bigint): Promise<User | null> {
    return prisma.user.findUnique({ where: { telegramId } });
  }

  async findManyByUsername(username: string): Promise<User[]> {
    return prisma.user.findMany({
      where: { username: { equals: username, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      take: 2,
    });
  }

  async upsert(telegramId: bigint, username: string | undefined, firstName: string | undefined): Promise<User> {
    return prisma.user.upsert({
      where: { telegramId },
      update: { username, firstName },
      create: { telegramId, username, firstName },
    });
  }

  async upsertFromTelegramUser(user: TelegramUserInput, seenAt: Date): Promise<User> {
    const telegramId = BigInt(user.id);

    const dbUser = await prisma.$transaction(async (transaction) => {
      if (user.username) {
        await transaction.user.updateMany({
          where: {
            telegramId: { not: telegramId },
            username: { equals: user.username, mode: "insensitive" },
          },
          data: { username: null },
        });
      }

      return transaction.user.upsert({
        where: { telegramId },
        update: {
          username: user.username ?? null,
          firstName: user.first_name,
          lastName: user.last_name,
          isBot: user.is_bot ?? false,
          lastSeenAt: seenAt,
        },
        create: {
          telegramId,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          isBot: user.is_bot ?? false,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        },
      });
    });

    if (!dbUser.firstSeenAt) {
      return prisma.user.update({
        where: { telegramId },
        data: { firstSeenAt: seenAt },
      });
    }

    return dbUser;
  }

  async markSeen(telegramId: bigint, seenAt: Date): Promise<User> {
    const existing = await this.findByTelegramId(telegramId);
    return prisma.user.update({
      where: { telegramId },
      data: {
        firstSeenAt: existing?.firstSeenAt ?? seenAt,
        lastSeenAt: seenAt,
      },
    });
  }

  async markClubStatus(
    telegramId: bigint,
    status: ClubMembershipStatus,
    occurredAt: Date,
  ): Promise<User> {
    return prisma.user.update({
      where: { telegramId },
      data: {
        clubStatus: status,
        joinedAt: status === ClubMembershipStatus.MEMBER ? occurredAt : undefined,
        leftAt:
          status === ClubMembershipStatus.LEFT || status === ClubMembershipStatus.REMOVED
            ? occurredAt
            : undefined,
        lastSeenAt: occurredAt,
      },
    });
  }

  async markMemberIfUnknown(telegramId: bigint, occurredAt: Date): Promise<User> {
    const user = await this.findByTelegramId(telegramId);
    if (!user) {
      throw new Error(`User ${telegramId} was not upserted before membership update`);
    }

    if (
      user.clubStatus !== ClubMembershipStatus.UNKNOWN &&
      user.clubStatus !== ClubMembershipStatus.JOIN_REQUESTED
    ) {
      return user;
    }

    return prisma.user.update({
      where: { telegramId },
      data: {
        clubStatus: ClubMembershipStatus.MEMBER,
        joinedAt: user.joinedAt ?? occurredAt,
        lastSeenAt: occurredAt,
      },
    });
  }

  async markBotActive(telegramId: bigint, occurredAt: Date): Promise<User> {
    const user = await this.findByTelegramId(telegramId);
    return prisma.user.update({
      where: { telegramId },
      data: {
        botStatus: BotInteractionStatus.ACTIVE,
        botStartedAt: user?.botStartedAt ?? occurredAt,
        lastSeenAt: occurredAt,
      },
    });
  }

  async markBotBlocked(telegramId: bigint, occurredAt: Date): Promise<User> {
    const user = await this.findByTelegramId(telegramId);
    return prisma.user.upsert({
      where: { telegramId },
      update: {
        botStatus: BotInteractionStatus.BLOCKED,
        botBlockedAt: user?.botBlockedAt ?? occurredAt,
        lastSeenAt: occurredAt,
      },
      create: {
        telegramId,
        botStatus: BotInteractionStatus.BLOCKED,
        botBlockedAt: occurredAt,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
      },
    });
  }

  async setVpnBlocked(telegramId: bigint, blocked: boolean): Promise<User> {
    return prisma.user.update({
      where: { telegramId },
      data: { vpnBlocked: blocked },
    });
  }

  async setBanned(telegramId: bigint, banned: boolean): Promise<User> {
    return prisma.user.update({
      where: { telegramId },
      data: {
        isBanned: banned,
        bannedAt: banned ? new Date() : null,
      },
    });
  }

  async setRole(telegramId: bigint, role: Role): Promise<User> {
    return prisma.user.update({
      where: { telegramId },
      data: { role },
    });
  }

  async hasAnyAdmin(): Promise<boolean> {
    const count = await prisma.user.count({ where: { role: Role.ADMIN } });
    return count > 0;
  }

  async findAllWithKeys(): Promise<(User & { vpnKeys: { isActive: boolean }[] })[]> {
    return prisma.user.findMany({
      include: {
        vpnKeys: {
          select: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}

export const userRepository = new UserRepository();
