import { execFile } from "node:child_process";
import { File } from "node:buffer";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type TranscriptionResult = {
  text: string;
  language?: string;
  segments?: unknown;
};

export interface TranscriptionProvider {
  isConfigured(): boolean;
  transcribe(filePath: string): Promise<TranscriptionResult>;
}

type OpenAITranscriptionResponse = {
  text?: unknown;
  language?: unknown;
  segments?: unknown;
  error?: {
    message?: unknown;
  };
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI transcription request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function convertToMp3(inputPath: string): Promise<string> {
  const dir = path.join(path.dirname(inputPath), ".transcription");
  await mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, `${path.basename(inputPath, path.extname(inputPath))}.mp3`);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    outputPath,
  ], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: config.media.conversionTimeoutMs,
  });

  return outputPath;
}

async function assertOpenAIFileSize(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = config.media.openaiTranscriptionMaxFileSizeMb * 1024 * 1024;
  if (fileStat.size > maxBytes) {
    throw new Error(
      `Transcription file is larger than OPENAI_TRANSCRIPTION_MAX_FILE_SIZE_MB (${config.media.openaiTranscriptionMaxFileSizeMb})`,
    );
  }
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  isConfigured(): boolean {
    return config.media.openaiApiKey.trim().length > 0;
  }

  async transcribe(filePath: string): Promise<TranscriptionResult> {
    let mp3Path: string | null = null;

    try {
      mp3Path = await convertToMp3(filePath);
      await assertOpenAIFileSize(mp3Path);

      const fileBuffer = await readFile(mp3Path);
      const formData = new FormData();
      formData.set("model", config.media.openaiTranscriptionModel);
      formData.set("response_format", "json");
      formData.set("file", new File([fileBuffer], path.basename(mp3Path), { type: "audio/mpeg" }));

      if (config.media.openaiTranscriptionLanguage) {
        formData.set("language", config.media.openaiTranscriptionLanguage);
      }

      if (config.media.openaiTranscriptionPrompt) {
        formData.set("prompt", config.media.openaiTranscriptionPrompt);
      }

      const response = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.media.openaiApiKey}`,
        },
        body: formData,
      }, config.media.openaiTranscriptionTimeoutMs);

      const json = await response.json() as OpenAITranscriptionResponse;
      if (!response.ok) {
        const message = typeof json.error?.message === "string"
          ? json.error.message
          : `OpenAI transcription failed with HTTP ${response.status}`;
        throw new Error(message);
      }

      if (typeof json.text !== "string") {
        throw new Error("OpenAI transcription response does not contain text");
      }

      return {
        text: json.text,
        language: typeof json.language === "string" ? json.language : undefined,
        segments: json.segments,
      };
    } finally {
      if (mp3Path) {
        await rm(mp3Path, { force: true });
      }
    }
  }
}

export const transcriptionProvider = new OpenAITranscriptionProvider();
