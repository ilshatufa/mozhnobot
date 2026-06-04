import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MediaProcessingStatus } from "@prisma/client";
import { type Telegram } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubMediaRepository } from "../repositories/club-media.repository.js";
import { clubMessageIndexRepository } from "../repositories/club-message-index.repository.js";
import { mediaProcessingJobRepository } from "../repositories/media-processing-job.repository.js";
import { botSettingRepository } from "../repositories/bot-setting.repository.js";
import { cleanTranscriptWithOpenAI } from "./transcript-cleaner.js";
import { transcriptionProvider } from "./transcription-provider.js";

type TelegramFileResult = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

const DOWNLOADABLE_STATUSES = [MediaProcessingStatus.PENDING];
const TRANSCRIBABLE_STATUSES = [MediaProcessingStatus.DOWNLOADED];
const PUBLISHABLE_STATUSES = [MediaProcessingStatus.TRANSCRIBED];
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TRANSCRIPT_HEADER = "<b>Расшифровка</b>";

function cleanTranscript(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function getFileExtension(filePath: string | undefined, mediaType: string): string {
  if (filePath) {
    const ext = path.extname(filePath);
    if (ext) return ext;
  }

  if (mediaType === "voice") return ".ogg";
  if (mediaType === "audio") return ".mp3";
  if (mediaType === "video_note" || mediaType === "video") return ".mp4";
  return ".bin";
}

function buildStoragePath(mediaType: string, uniqueId: string | null, jobId: number, filePath?: string): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const safeName = (uniqueId ?? `job_${jobId}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = getFileExtension(filePath, mediaType);
  return path.join(config.media.storageDir, year, month, day, `${safeName}${ext}`);
}

function buildTelegramFileUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, TELEGRAM_MESSAGE_LIMIT);
    const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
    const end = lastBreak > 1000 ? lastBreak + 1 : TELEGRAM_MESSAGE_LIMIT;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  return chunks;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export class MediaProcessingService {
  private telegram: Telegram | null = null;
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  start(telegram: Telegram): void {
    if (!config.media.processingEnabled || this.interval) return;

    this.telegram = telegram;
    this.interval = setInterval(() => {
      void this.tick();
    }, config.media.workerIntervalMs);
    void this.tick();

    logger.info("Media processing worker started", {
      intervalMs: config.media.workerIntervalMs,
      storageDir: config.media.storageDir,
      transcriptionConfigured: transcriptionProvider.isConfigured(),
    });
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    this.telegram = null;
  }

  private async tick(): Promise<void> {
    if (this.running || !this.telegram) return;
    this.running = true;

    try {
      const transcriptionEnabled = await botSettingRepository.isTranscriptionEnabled();
      if (transcriptionEnabled) {
        await this.resetStaleJobs();
        await this.processPendingDownload();
        await this.processPendingTranscription();
        await this.processPendingPublication();
      }
      await this.cleanupStoredFiles();
    } catch (error) {
      logger.error("Media processing tick failed", { error });
    } finally {
      this.running = false;
    }
  }

  private async resetStaleJobs(): Promise<void> {
    const before = new Date(Date.now() - config.media.inProgressStaleMs);
    const resetCount = await mediaProcessingJobRepository.resetStaleInProgress(before);
    if (resetCount > 0) {
      logger.warn("Reset stale media processing jobs", {
        resetCount,
        staleMs: config.media.inProgressStaleMs,
      });
    }
  }

  private async processPendingDownload(): Promise<void> {
    const job = await mediaProcessingJobRepository.takeNext(DOWNLOADABLE_STATUSES);
    if (!job || !this.telegram) return;

    const media = await clubMediaRepository.findById(job.mediaId);
    if (!media) {
      await mediaProcessingJobRepository.markSkipped(job.id, "Media record not found");
      return;
    }

    const maxBytes = config.media.maxFileSizeMb * 1024 * 1024;
    if (media.fileSize && media.fileSize > maxBytes) {
      await mediaProcessingJobRepository.markSkipped(
        job.id,
        `File is larger than MEDIA_MAX_FILE_SIZE_MB (${config.media.maxFileSizeMb})`,
      );
      return;
    }

    try {
      const telegramFile = await this.telegram.getFile(media.telegramFileId) as TelegramFileResult;
      if (!telegramFile.file_path) {
        throw new Error("Telegram did not return file_path");
      }

      if (telegramFile.file_size && telegramFile.file_size > maxBytes) {
        await mediaProcessingJobRepository.markSkipped(
          job.id,
          `File is larger than MEDIA_MAX_FILE_SIZE_MB (${config.media.maxFileSizeMb})`,
        );
        return;
      }

      const response = await fetch(buildTelegramFileUrl(telegramFile.file_path));
      if (!response.ok) {
        throw new Error(`Telegram file download failed with HTTP ${response.status}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) {
        await mediaProcessingJobRepository.markSkipped(
          job.id,
          `File is larger than MEDIA_MAX_FILE_SIZE_MB (${config.media.maxFileSizeMb})`,
        );
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > maxBytes) {
        await mediaProcessingJobRepository.markSkipped(
          job.id,
          `File is larger than MEDIA_MAX_FILE_SIZE_MB (${config.media.maxFileSizeMb})`,
        );
        return;
      }

      const targetPath = buildStoragePath(
        media.mediaType,
        media.telegramFileUniqueId,
        job.id,
        telegramFile.file_path,
      );
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(arrayBuffer));
      await mediaProcessingJobRepository.markDownloaded(job.id, targetPath);
    } catch (error) {
      logger.warn("Media download failed", {
        jobId: job.id,
        mediaId: job.mediaId,
        error: errorMessage(error),
      });
      await mediaProcessingJobRepository.markFailure(
        job,
        errorMessage(error),
        config.media.downloadMaxAttempts,
      );
    }
  }

  private async processPendingTranscription(): Promise<void> {
    const job = await mediaProcessingJobRepository.takeNext(TRANSCRIBABLE_STATUSES);
    if (!job) return;

    if (!job.downloadedFilePath) {
      await mediaProcessingJobRepository.markSkipped(job.id, "Downloaded file path is missing");
      return;
    }

    if (!transcriptionProvider.isConfigured()) {
      await mediaProcessingJobRepository.markSkipped(job.id, "Transcription provider is not configured");
      return;
    }

    try {
      const result = await transcriptionProvider.transcribe(job.downloadedFilePath);
      const transcriptClean = await cleanTranscriptWithOpenAI(result.text);
      await mediaProcessingJobRepository.markTranscribed(job.id, {
        transcriptRaw: result.text,
        transcriptClean,
        transcriptLanguage: result.language,
        transcriptSegments: result.segments,
      });
    } catch (error) {
      logger.warn("Media transcription failed", {
        jobId: job.id,
        mediaId: job.mediaId,
        error: errorMessage(error),
      });
      await mediaProcessingJobRepository.markFailure(
        job,
        errorMessage(error),
        config.media.downloadMaxAttempts,
      );
    }
  }

  private async processPendingPublication(): Promise<void> {
    const job = await mediaProcessingJobRepository.takeNext(PUBLISHABLE_STATUSES);
    if (!job || !this.telegram) return;

    const media = await clubMediaRepository.findById(job.mediaId);
    if (!media) {
      await mediaProcessingJobRepository.markSkipped(job.id, "Media record not found");
      return;
    }

    const message = await clubMessageIndexRepository.findById(media.messageIndexId);
    if (!message) {
      await mediaProcessingJobRepository.markSkipped(job.id, "Message index record not found");
      return;
    }

    const transcript = job.transcriptClean?.trim();
    if (!transcript) {
      await mediaProcessingJobRepository.markSkipped(job.id, "Transcript is empty");
      return;
    }

    try {
      const baseText = `${TRANSCRIPT_HEADER}\n\n${escapeHtml(transcript)}`;
      const chunks = splitTelegramMessage(baseText);
      let firstMessageId: number | null = null;

      for (let index = 0; index < chunks.length; index += 1) {
        const text = chunks.length > 1
          ? `${chunks[index]}\n\n(${index + 1}/${chunks.length})`
          : chunks[index];
        const sent = await this.telegram.sendMessage(String(media.chatTelegramId), text, {
          parse_mode: "HTML",
          message_thread_id: message.telegramMessageThreadId,
          reply_parameters: index === 0 ? { message_id: media.telegramMessageId } : undefined,
        } as never);

        if (index === 0) {
          firstMessageId = sent.message_id;
        }
      }

      await mediaProcessingJobRepository.markPublished(job.id, firstMessageId);
    } catch (error) {
      logger.warn("Media publication failed", {
        jobId: job.id,
        mediaId: job.mediaId,
        error: errorMessage(error),
      });
      await mediaProcessingJobRepository.markFailure(
        job,
        errorMessage(error),
        config.media.downloadMaxAttempts,
      );
    }
  }

  private async cleanupStoredFiles(): Promise<void> {
    const transcribedBefore = new Date(Date.now() - config.media.retentionDays * 24 * 60 * 60 * 1000);
    const failedBefore = new Date(Date.now() - config.media.failedRetentionDays * 24 * 60 * 60 * 1000);

    const [transcribedJobs, failedJobs] = await Promise.all([
      mediaProcessingJobRepository.findFilesForCleanup(transcribedBefore, [MediaProcessingStatus.TRANSCRIBED]),
      mediaProcessingJobRepository.findFilesForCleanup(failedBefore, [
        MediaProcessingStatus.FAILED,
        MediaProcessingStatus.SKIPPED,
      ]),
    ]);

    for (const job of [...transcribedJobs, ...failedJobs]) {
      if (!job.downloadedFilePath) continue;

      try {
        await rm(job.downloadedFilePath, { force: true });
        await mediaProcessingJobRepository.clearDownloadedFilePath(job.id);
      } catch (error) {
        logger.warn("Failed to remove media file", {
          jobId: job.id,
          error,
        });
      }
    }
  }
}

export const mediaProcessingService = new MediaProcessingService();
