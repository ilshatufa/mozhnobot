import { type ClubMessageIndex } from "@prisma/client";
import { prisma } from "../database.js";

export type ClubMessageIndexInput = {
  chatTelegramId: bigint;
  telegramMessageId: number;
  telegramMessageThreadId?: number;
  authorTelegramId?: bigint;
  replyToTelegramMessageId?: number;
  messageType: string;
  text?: string;
  caption?: string;
  postedAt: Date;
  editedAt?: Date;
};

export class ClubMessageIndexRepository {
  async upsert(input: ClubMessageIndexInput): Promise<ClubMessageIndex> {
    const text = input.text ?? null;
    const caption = input.caption ?? null;

    return prisma.clubMessageIndex.upsert({
      where: {
        chatTelegramId_telegramMessageId: {
          chatTelegramId: input.chatTelegramId,
          telegramMessageId: input.telegramMessageId,
        },
      },
      update: {
        telegramMessageThreadId: input.telegramMessageThreadId,
        authorTelegramId: input.authorTelegramId,
        replyToTelegramMessageId: input.replyToTelegramMessageId,
        messageType: input.messageType,
        text,
        caption,
        textLength: text?.length ?? null,
        captionLength: caption?.length ?? null,
        editedAt: input.editedAt,
      },
      create: {
        chatTelegramId: input.chatTelegramId,
        telegramMessageId: input.telegramMessageId,
        telegramMessageThreadId: input.telegramMessageThreadId,
        authorTelegramId: input.authorTelegramId,
        replyToTelegramMessageId: input.replyToTelegramMessageId,
        messageType: input.messageType,
        text,
        caption,
        textLength: text?.length ?? null,
        captionLength: caption?.length ?? null,
        postedAt: input.postedAt,
        editedAt: input.editedAt,
      },
    });
  }

  async findByTelegramMessage(
    chatTelegramId: bigint,
    telegramMessageId: number,
  ): Promise<ClubMessageIndex | null> {
    return prisma.clubMessageIndex.findUnique({
      where: {
        chatTelegramId_telegramMessageId: {
          chatTelegramId,
          telegramMessageId,
        },
      },
    });
  }

  async findById(id: number): Promise<ClubMessageIndex | null> {
    return prisma.clubMessageIndex.findUnique({ where: { id } });
  }
}

export const clubMessageIndexRepository = new ClubMessageIndexRepository();
