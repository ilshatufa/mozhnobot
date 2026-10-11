import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Input, type Telegram } from "telegraf";
import { config } from "../config.js";
import { botSettingRepository } from "../repositories/bot-setting.repository.js";
import { isVideoForbiddenError } from "../telegram-errors.js";
import { cleanTranscriptWithQwen } from "./transcript-cleaner.js";
import { transcriptionProvider } from "./transcription-provider.js";

const VIDEO_1_SETTING_KEY = "clubni.onboarding.video1";
const VIDEO_2_SETTING_KEY = "clubni.onboarding.video2";
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TRANSCRIPT_CHUNK_LIMIT = 3000;

export type ClubniOnboardingVideo = {
  fileId: string;
  fileUniqueId: string;
  transcript: string | null;
};

export type ClubniOnboardingVideoConfiguration = {
  video: ClubniOnboardingVideo;
  transcriptPrepared: boolean;
  transcriptionError: string | null;
};

type TelegramFile = {
  file_path?: string;
  file_size?: number;
};

type VideoSender = Pick<Telegram, "sendVideo" | "sendMessage">;
type VideoSource = Parameters<Telegram["sendVideo"]>[1];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function splitTranscript(transcript: string): string[] {
  const normalized = transcript.trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > TRANSCRIPT_CHUNK_LIMIT) {
    const paragraphBreak = rest.lastIndexOf("\n\n", TRANSCRIPT_CHUNK_LIMIT);
    const sentenceBreak = rest.lastIndexOf(". ", TRANSCRIPT_CHUNK_LIMIT);
    const spaceBreak = rest.lastIndexOf(" ", TRANSCRIPT_CHUNK_LIMIT);
    const splitAt = paragraphBreak > 0
      ? paragraphBreak
      : sentenceBreak > 0
        ? sentenceBreak + 1
        : spaceBreak > 0
          ? spaceBreak
          : TRANSCRIPT_CHUNK_LIMIT;
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function buildClubniTranscriptMessages(
  transcript: string,
  question: string,
): string[] {
  const chunks = splitTranscript(transcript);
  if (chunks.length === 0) throw new Error("Clubni onboarding transcript is empty");

  return chunks.map((chunk, index) => {
    const heading = index === 0
      ? "🎬 <b>Первое видео — текстовая версия</b>"
      : "<b>Продолжение</b>";
    const questionBlock = index === chunks.length - 1
      ? `\n\n❓ <b>Вопрос</b>\n${escapeHtml(question)}\n\nНапиши ответ одним сообщением.`
      : "";
    const message = `${heading}\n\n${escapeHtml(chunk)}${questionBlock}`;
    if (message.length > TELEGRAM_MESSAGE_LIMIT) {
      throw new Error("Clubni onboarding transcript message is too long");
    }
    return message;
  });
}

export function parseStoredVideo(value: string | null): ClubniOnboardingVideo | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ClubniOnboardingVideo>;
    if (
      typeof parsed.fileId !== "string" || !parsed.fileId ||
      typeof parsed.fileUniqueId !== "string" || !parsed.fileUniqueId ||
      (parsed.transcript !== null && typeof parsed.transcript !== "string")
    ) {
      return null;
    }
    return {
      fileId: parsed.fileId,
      fileUniqueId: parsed.fileUniqueId,
      transcript: typeof parsed.transcript === "string" && parsed.transcript.trim()
        ? parsed.transcript.trim()
        : null,
    };
  } catch {
    return null;
  }
}

export async function getClubniOnboardingVideo1(): Promise<ClubniOnboardingVideo | null> {
  return parseStoredVideo(await botSettingRepository.getString(VIDEO_1_SETTING_KEY));
}

export async function getClubniOnboardingVideo2(): Promise<ClubniOnboardingVideo | null> {
  return parseStoredVideo(await botSettingRepository.getString(VIDEO_2_SETTING_KEY));
}

async function downloadTelegramVideo(
  telegram: Pick<Telegram, "getFile">,
  fileId: string,
): Promise<{ directory: string; filePath: string }> {
  const file = await telegram.getFile(fileId) as TelegramFile;
  if (!file.file_path) throw new Error("Telegram did not return a video file path");
  const maxBytes = config.media.maxFileSizeMb * 1024 * 1024;
  if (typeof file.file_size === "number" && file.file_size > maxBytes) {
    throw new Error(`Video is larger than MEDIA_MAX_FILE_SIZE_MB (${config.media.maxFileSizeMb})`);
  }

  const response = await fetch(
    `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
  );
  if (!response.ok) throw new Error(`Telegram video download failed with HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Video is larger than MEDIA_MAX_FILE_SIZE_MB (${config.media.maxFileSizeMb})`);
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "clubni-onboarding-"));
  const extension = path.extname(file.file_path) || ".mp4";
  const filePath = path.join(directory, `video-1${extension}`);
  await writeFile(filePath, buffer);
  return { directory, filePath };
}

export async function configureClubniOnboardingVideo1(
  telegram: Pick<Telegram, "getFile">,
  video: { fileId: string; fileUniqueId: string },
): Promise<ClubniOnboardingVideoConfiguration> {
  const stored: ClubniOnboardingVideo = {
    fileId: video.fileId,
    fileUniqueId: video.fileUniqueId,
    transcript: null,
  };
  await botSettingRepository.setString(VIDEO_1_SETTING_KEY, JSON.stringify(stored));

  if (!transcriptionProvider.isConfigured()) {
    return {
      video: stored,
      transcriptPrepared: false,
      transcriptionError: "Transcription provider is not configured",
    };
  }

  let downloaded: { directory: string; filePath: string } | null = null;
  try {
    downloaded = await downloadTelegramVideo(telegram, video.fileId);
    const raw = await transcriptionProvider.transcribe(downloaded.filePath);
    const transcript = await cleanTranscriptWithQwen(raw.text);
    stored.transcript = transcript;
    await botSettingRepository.setString(VIDEO_1_SETTING_KEY, JSON.stringify(stored));
    return {
      video: stored,
      transcriptPrepared: true,
      transcriptionError: null,
    };
  } catch (error) {
    return {
      video: stored,
      transcriptPrepared: false,
      transcriptionError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (downloaded) {
      await rm(downloaded.directory, { force: true, recursive: true });
    }
  }
}

export async function sendClubniOnboardingVideo1(
  telegram: VideoSender,
  telegramUserId: number,
  localFallbackPath: string,
  question: string,
): Promise<"video" | "transcript"> {
  const configured = await getClubniOnboardingVideo1();
  const source = configured?.fileId ?? Input.fromLocalFile(localFallbackPath);

  return sendVideoWithTranscriptFallback(
    telegram,
    telegramUserId,
    source,
    configured?.transcript ?? null,
    question,
  );
}

export async function sendVideoWithTranscriptFallback(
  telegram: VideoSender,
  telegramUserId: number,
  source: VideoSource,
  transcript: string | null,
  question: string,
): Promise<"video" | "transcript"> {

  try {
    await telegram.sendVideo(telegramUserId, source, {
      caption: `${question}\n\nНапиши ответ одним сообщением.`,
    });
    return "video";
  } catch (error) {
    if (!transcript || !isVideoForbiddenError(error)) throw error;
    for (const message of buildClubniTranscriptMessages(transcript, question)) {
      await telegram.sendMessage(telegramUserId, message, { parse_mode: "HTML" });
    }
    return "transcript";
  }
}
