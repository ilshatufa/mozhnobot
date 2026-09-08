import { ClubSearchRequestStatus, Prisma, type ClubSearchRequest } from "@prisma/client";
import { prisma } from "../database.js";

export type CreateClubSearchRequestInput = {
  requesterTelegramId: bigint;
  telegramChatId: bigint;
  progressMessageId: number;
  question: string;
};

export class ClubSearchRequestRepository {
  async findActiveForRequester(requesterTelegramId: bigint): Promise<ClubSearchRequest | null> {
    return prisma.clubSearchRequest.findUnique({
      where: { activeKey: requesterTelegramId.toString() },
    });
  }

  async create(input: CreateClubSearchRequestInput): Promise<ClubSearchRequest> {
    return prisma.clubSearchRequest.create({
      data: {
        ...input,
        activeKey: input.requesterTelegramId.toString(),
      },
    });
  }

  isActiveKeyConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  async findWaitingForProgress(limit = 10): Promise<ClubSearchRequest[]> {
    return prisma.clubSearchRequest.findMany({
      where: {
        status: ClubSearchRequestStatus.PROCESSING,
        progressStage: 0,
        startedAt: { lte: new Date(Date.now() - 10_000) },
      },
      orderBy: { startedAt: "asc" },
      take: limit,
    });
  }

  async markProgressUpdated(id: string): Promise<boolean> {
    const result = await prisma.clubSearchRequest.updateMany({
      where: { id, progressStage: 0 },
      data: { progressStage: 1 },
    });
    return result.count === 1;
  }

  async findReadyForDelivery(limit = 10): Promise<ClubSearchRequest[]> {
    return prisma.clubSearchRequest.findMany({
      where: {
        deliveredAt: null,
        status: { in: [ClubSearchRequestStatus.COMPLETED, ClubSearchRequestStatus.FAILED] },
      },
      orderBy: { completedAt: "asc" },
      take: limit,
    });
  }

  async markDelivered(id: string): Promise<void> {
    await prisma.clubSearchRequest.update({
      where: { id },
      data: { deliveredAt: new Date() },
    });
  }
}

export const clubSearchRequestRepository = new ClubSearchRequestRepository();
