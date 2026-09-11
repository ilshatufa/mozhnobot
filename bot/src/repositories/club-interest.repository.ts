import { prisma } from "../database.js";

export type WaitlistedClubUser = {
  waitlistedAt: Date;
  user: {
    telegramId: bigint;
    username: string | null;
    firstName: string | null;
  };
};

export class ClubInterestRepository {
  async recordOpened(userId: number): Promise<void> {
    await prisma.clubInterest.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async recordWaitlisted(userId: number): Promise<void> {
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.clubInterest.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      await tx.clubInterest.updateMany({
        where: { userId, waitlistedAt: null },
        data: { waitlistedAt: now },
      });
    });
  }

  async findAllWaitlisted(): Promise<WaitlistedClubUser[]> {
    const entries = await prisma.clubInterest.findMany({
      where: { waitlistedAt: { not: null } },
      orderBy: { waitlistedAt: "desc" },
      select: {
        waitlistedAt: true,
        user: {
          select: {
            telegramId: true,
            username: true,
            firstName: true,
          },
        },
      },
    });

    return entries.flatMap((entry) =>
      entry.waitlistedAt
        ? [{ waitlistedAt: entry.waitlistedAt, user: entry.user }]
        : [],
    );
  }
}

export const clubInterestRepository = new ClubInterestRepository();
