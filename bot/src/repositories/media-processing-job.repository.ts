import { MediaProcessingStatus, type MediaProcessingJob } from "@prisma/client";
import { prisma } from "../database.js";

export class MediaProcessingJobRepository {
  async createIfNotExists(
    mediaId: number,
    status: MediaProcessingStatus = MediaProcessingStatus.PENDING,
  ): Promise<MediaProcessingJob> {
    const disabled = status === MediaProcessingStatus.DISABLED;

    return prisma.mediaProcessingJob.upsert({
      where: { mediaId },
      update: {},
      create: {
        mediaId,
        status,
        lastError: disabled ? "Transcription was disabled when media was received" : undefined,
        processedAt: disabled ? new Date() : undefined,
      },
    });
  }

  async takeNext(statuses: MediaProcessingStatus[]): Promise<MediaProcessingJob | null> {
    const job = await prisma.mediaProcessingJob.findFirst({
      where: { status: { in: statuses } },
      orderBy: { createdAt: "asc" },
    });

    if (!job) return null;

    return prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: {
        status:
          job.status === MediaProcessingStatus.PENDING
            ? MediaProcessingStatus.DOWNLOADING
            : job.status === MediaProcessingStatus.DOWNLOADED
              ? MediaProcessingStatus.TRANSCRIBING
              : MediaProcessingStatus.PUBLISHING,
      },
    });
  }

  async resetStaleInProgress(before: Date): Promise<number> {
    const [downloads, transcriptions, publications] = await prisma.$transaction([
      prisma.mediaProcessingJob.updateMany({
        where: {
          status: MediaProcessingStatus.DOWNLOADING,
          updatedAt: { lt: before },
        },
        data: {
          status: MediaProcessingStatus.PENDING,
          lastError: "Reset stale downloading job",
        },
      }),
      prisma.mediaProcessingJob.updateMany({
        where: {
          status: MediaProcessingStatus.TRANSCRIBING,
          updatedAt: { lt: before },
        },
        data: {
          status: MediaProcessingStatus.DOWNLOADED,
          lastError: "Reset stale transcribing job",
        },
      }),
      prisma.mediaProcessingJob.updateMany({
        where: {
          status: MediaProcessingStatus.PUBLISHING,
          updatedAt: { lt: before },
        },
        data: {
          status: MediaProcessingStatus.TRANSCRIBED,
          lastError: "Reset stale publishing job",
        },
      }),
    ]);

    return downloads.count + transcriptions.count + publications.count;
  }

  async markDownloaded(id: number, downloadedFilePath: string): Promise<MediaProcessingJob> {
    return prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingStatus.DOWNLOADED,
        downloadedFilePath,
        lastError: null,
      },
    });
  }

  async markTranscribed(
    id: number,
    data: {
      transcriptRaw: string;
      transcriptClean: string;
      transcriptLanguage?: string;
      transcriptSegments?: unknown;
    },
  ): Promise<MediaProcessingJob> {
    return prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingStatus.TRANSCRIBED,
        transcriptRaw: data.transcriptRaw,
        transcriptClean: data.transcriptClean,
        transcriptLanguage: data.transcriptLanguage,
        transcriptSegments: data.transcriptSegments === undefined ? undefined : JSON.parse(JSON.stringify(data.transcriptSegments)),
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  async markSkipped(id: number, reason: string): Promise<MediaProcessingJob> {
    return prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingStatus.SKIPPED,
        lastError: reason,
        processedAt: new Date(),
      },
    });
  }

  async markPublished(id: number, publishedMessageId: number | null): Promise<MediaProcessingJob> {
    return prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingStatus.PUBLISHED,
        publishedMessageId,
        publishedAt: new Date(),
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  async markFailure(
    job: MediaProcessingJob,
    error: string,
    maxAttempts: number,
  ): Promise<MediaProcessingJob> {
    const attempts = job.attempts + 1;
    let retryStatus: MediaProcessingStatus = MediaProcessingStatus.PENDING;

    if (job.status === MediaProcessingStatus.TRANSCRIBING) {
      retryStatus = MediaProcessingStatus.DOWNLOADED;
    }

    if (job.status === MediaProcessingStatus.PUBLISHING) {
      retryStatus = MediaProcessingStatus.TRANSCRIBED;
    }

    return prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: {
        attempts,
        lastError: error,
        status: attempts >= maxAttempts ? MediaProcessingStatus.FAILED : retryStatus,
        processedAt: attempts >= maxAttempts ? new Date() : undefined,
      },
    });
  }

  async findFilesForCleanup(before: Date, statuses: MediaProcessingStatus[]): Promise<MediaProcessingJob[]> {
    return prisma.mediaProcessingJob.findMany({
      where: {
        status: { in: statuses },
        downloadedFilePath: { not: null },
        updatedAt: { lt: before },
      },
      take: 50,
      orderBy: { updatedAt: "asc" },
    });
  }

  async clearDownloadedFilePath(id: number): Promise<MediaProcessingJob> {
    return prisma.mediaProcessingJob.update({
      where: { id },
      data: { downloadedFilePath: null },
    });
  }
}

export const mediaProcessingJobRepository = new MediaProcessingJobRepository();
