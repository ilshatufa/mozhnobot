import { Role, type User } from "@prisma/client";
import { prisma } from "../database.js";

export class UserRepository {
  async findByTelegramId(telegramId: bigint): Promise<User | null> {
    return prisma.user.findUnique({ where: { telegramId } });
  }

  async upsert(telegramId: bigint, username: string | undefined, firstName: string | undefined): Promise<User> {
    return prisma.user.upsert({
      where: { telegramId },
      update: { username, firstName },
      create: { telegramId, username, firstName },
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

  async findAllWithKeys(): Promise<(User & { vpnKeys: { isActive: boolean; expiresAt: Date }[] })[]> {
    return prisma.user.findMany({
      include: {
        vpnKeys: {
          select: { isActive: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}

export const userRepository = new UserRepository();
