import { prisma } from "../database.js";

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
}

export const clubInterestRepository = new ClubInterestRepository();
