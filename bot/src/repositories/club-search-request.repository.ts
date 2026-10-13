import {
  ClubSearchRequestMode,
  ClubSearchRequestStatus,
  Prisma,
  type ClubSearchRequest,
} from "@prisma/client";
import { prisma } from "../database.js";

export type CreateClubSearchRequestInput = {
  requesterTelegramId: bigint;
  telegramChatId: bigint;
  progressMessageId: number;
  question: string;
  mode: ClubSearchRequestMode;
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

  async claimNextPending(): Promise<ClubSearchRequest | null> {
    return prisma.$transaction(async (transaction) => {
      const candidate = await transaction.clubSearchRequest.findFirst({
        where: { status: ClubSearchRequestStatus.PENDING },
        orderBy: { createdAt: "asc" },
      });
      if (!candidate) return null;

      const claimed = await transaction.clubSearchRequest.updateMany({
        where: { id: candidate.id, status: ClubSearchRequestStatus.PENDING },
        data: {
          status: ClubSearchRequestStatus.PROCESSING,
          startedAt: new Date(),
          attempts: { increment: 1 },
          errorCode: null,
        },
      });
      if (claimed.count !== 1) return null;
      return transaction.clubSearchRequest.findUnique({ where: { id: candidate.id } });
    });
  }

  async complete(
    id: string,
    result: {
      answer: string | null;
      sourceMessageIds?: number[];
      webSources?: Prisma.InputJsonValue;
      resultCode?: string | null;
    },
  ): Promise<void> {
    await prisma.clubSearchRequest.update({
      where: { id },
      data: {
        status: ClubSearchRequestStatus.COMPLETED,
        answer: result.answer,
        sourceMessageIds: result.sourceMessageIds ?? [],
        webSources: result.webSources ?? [],
        errorCode: result.resultCode ?? null,
        activeKey: null,
        completedAt: new Date(),
      },
    });
  }

  async fail(id: string, errorCode: string): Promise<void> {
    await prisma.clubSearchRequest.update({
      where: { id },
      data: {
        status: ClubSearchRequestStatus.FAILED,
        errorCode: errorCode.slice(0, 64),
        activeKey: null,
        completedAt: new Date(),
      },
    });
  }

  async failStaleProcessing(staleBefore: Date): Promise<number> {
    const result = await prisma.clubSearchRequest.updateMany({
      where: {
        status: ClubSearchRequestStatus.PROCESSING,
        startedAt: { lt: staleBefore },
      },
      data: {
        status: ClubSearchRequestStatus.FAILED,
        errorCode: "PROCESSING_TIMEOUT",
        activeKey: null,
        completedAt: new Date(),
      },
    });
    return result.count;
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
