import { ClubTopicStatus, type ClubTopic } from "@prisma/client";
import { prisma } from "../database.js";

export class ClubTopicRepository {
  async upsert(
    chatTelegramId: bigint,
    telegramMessageThreadId: number,
    data?: { name?: string | null; status?: ClubTopicStatus },
  ): Promise<ClubTopic> {
    return prisma.clubTopic.upsert({
      where: {
        chatTelegramId_telegramMessageThreadId: {
          chatTelegramId,
          telegramMessageThreadId,
        },
      },
      update: {
        name: data?.name ?? undefined,
        status: data?.status,
      },
      create: {
        chatTelegramId,
        telegramMessageThreadId,
        name: data?.name,
        status: data?.status ?? ClubTopicStatus.ACTIVE,
      },
    });
  }
}

export const clubTopicRepository = new ClubTopicRepository();
