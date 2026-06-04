import { Prisma, type ClubEvent } from "@prisma/client";
import { prisma } from "../database.js";

export type ClubEventInput = {
  telegramUpdateId?: bigint;
  dedupeKey: string;
  eventType: string;
  chatTelegramId?: bigint;
  telegramMessageThreadId?: number;
  userTelegramId?: bigint;
  messageTelegramId?: number;
  targetUserTelegramId?: bigint;
  targetMessageTelegramId?: number;
  occurredAt: Date;
  payload?: Prisma.InputJsonValue;
};

export class ClubEventRepository {
  async createIfNotExists(input: ClubEventInput): Promise<ClubEvent | null> {
    try {
      return await prisma.clubEvent.create({
        data: {
          telegramUpdateId: input.telegramUpdateId,
          dedupeKey: input.dedupeKey,
          eventType: input.eventType,
          chatTelegramId: input.chatTelegramId,
          telegramMessageThreadId: input.telegramMessageThreadId,
          userTelegramId: input.userTelegramId,
          messageTelegramId: input.messageTelegramId,
          targetUserTelegramId: input.targetUserTelegramId,
          targetMessageTelegramId: input.targetMessageTelegramId,
          occurredAt: input.occurredAt,
          payload: input.payload,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return null;
      }

      throw error;
    }
  }
}

export const clubEventRepository = new ClubEventRepository();
