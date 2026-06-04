import { type ClubMedia } from "@prisma/client";
import { prisma } from "../database.js";

export type ClubMediaInput = {
  messageIndexId: number;
  chatTelegramId: bigint;
  telegramMessageId: number;
  mediaType: string;
  telegramFileId: string;
  telegramFileUniqueId?: string;
  durationSeconds?: number;
  fileSize?: number;
  mimeType?: string;
  title?: string;
  performer?: string;
};

export class ClubMediaRepository {
  async upsert(input: ClubMediaInput): Promise<ClubMedia> {
    return prisma.clubMedia.upsert({
      where: {
        chatTelegramId_telegramMessageId_mediaType: {
          chatTelegramId: input.chatTelegramId,
          telegramMessageId: input.telegramMessageId,
          mediaType: input.mediaType,
        },
      },
      update: {
        messageIndexId: input.messageIndexId,
        telegramFileId: input.telegramFileId,
        telegramFileUniqueId: input.telegramFileUniqueId,
        durationSeconds: input.durationSeconds,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        title: input.title,
        performer: input.performer,
      },
      create: {
        messageIndexId: input.messageIndexId,
        chatTelegramId: input.chatTelegramId,
        telegramMessageId: input.telegramMessageId,
        mediaType: input.mediaType,
        telegramFileId: input.telegramFileId,
        telegramFileUniqueId: input.telegramFileUniqueId,
        durationSeconds: input.durationSeconds,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        title: input.title,
        performer: input.performer,
      },
    });
  }

  async findById(id: number): Promise<ClubMedia | null> {
    return prisma.clubMedia.findUnique({ where: { id } });
  }
}

export const clubMediaRepository = new ClubMediaRepository();
