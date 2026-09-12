import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
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

export type QwenTranscriptionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
      annotations?: Array<{
        language?: unknown;
        emotion?: unknown;
        type?: unknown;
      }>;
    };
  }>;
  error?: {
    message?: unknown;
  };
  message?: unknown;
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
      throw new Error(`Qwen transcription request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function convertToMp3Chunks(inputPath: string): Promise<{ dir: string; paths: string[] }> {
  const parentDir = path.join(path.dirname(inputPath), ".transcription");
  await mkdir(parentDir, { recursive: true });
  const dir = await mkdtemp(path.join(parentDir, `${path.basename(inputPath, path.extname(inputPath))}-`));
  const outputPattern = path.join(dir, "chunk-%03d.mp3");

  try {
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
      "-f",
      "segment",
      "-segment_time",
      String(config.media.qwenTranscriptionChunkSeconds),
      "-reset_timestamps",
      "1",
      outputPattern,
    ], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: config.media.conversionTimeoutMs,
    });

    const paths = (await readdir(dir))
      .filter((name) => name.endsWith(".mp3"))
      .sort()
      .map((name) => path.join(dir, name));
    if (paths.length === 0) throw new Error("ffmpeg did not create transcription chunks");
    return { dir, paths };
  } catch (error) {
    await rm(dir, { force: true, recursive: true });
    throw error;
  }
}

async function assertQwenFileSize(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = config.media.qwenTranscriptionMaxFileSizeMb * 1024 * 1024;
  if (fileStat.size > maxBytes) {
    throw new Error(
      `Transcription chunk is larger than QWEN_TRANSCRIPTION_MAX_FILE_SIZE_MB (${config.media.qwenTranscriptionMaxFileSizeMb})`,
    );
  }
}

export function parseQwenTranscriptionResponse(json: QwenTranscriptionResponse): TranscriptionResult {
  const message = json.choices?.[0]?.message;
  const text = typeof message?.content === "string" ? message.content.trim() : "";
  if (!text) throw new Error("Qwen transcription response does not contain text");
  const audioInfo = message?.annotations?.find((annotation) => annotation.type === "audio_info");
  return {
    text,
    language: typeof audioInfo?.language === "string" ? audioInfo.language : undefined,
    segments: message?.annotations,
  };
}

async function transcribeChunk(filePath: string): Promise<TranscriptionResult> {
  await assertQwenFileSize(filePath);
  const fileBuffer = await readFile(filePath);
  const inputAudio = `data:audio/mpeg;base64,${fileBuffer.toString("base64")}`;
  const asrOptions: Record<string, unknown> = { enable_itn: true };
  if (config.media.qwenTranscriptionLanguage) {
    asrOptions.language = config.media.qwenTranscriptionLanguage;
  }

  const response = await fetchWithTimeout(`${config.media.qwenBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.media.qwenApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.media.qwenTranscriptionModel,
      messages: [{
        role: "user",
        content: [{
          type: "input_audio",
          input_audio: { data: inputAudio },
        }],
      }],
      stream: false,
      asr_options: asrOptions,
    }),
  }, config.media.qwenTranscriptionTimeoutMs);

  const json = await response.json() as QwenTranscriptionResponse;
  if (!response.ok) {
    const message = typeof json.error?.message === "string"
      ? json.error.message
      : typeof json.message === "string"
        ? json.message
        : `Qwen transcription failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return parseQwenTranscriptionResponse(json);
}

export class QwenTranscriptionProvider implements TranscriptionProvider {
  isConfigured(): boolean {
    return config.media.qwenApiKey.trim().length > 0;
  }

  async transcribe(filePath: string): Promise<TranscriptionResult> {
    let chunksDir: string | null = null;

    try {
      const chunks = await convertToMp3Chunks(filePath);
      chunksDir = chunks.dir;
      const results: TranscriptionResult[] = [];
      for (const chunkPath of chunks.paths) {
        results.push(await transcribeChunk(chunkPath));
      }
      return {
        text: results.map((result) => result.text).join(" ").trim(),
        language: results.find((result) => result.language)?.language,
        segments: results.map((result, index) => ({
          chunk: index + 1,
          annotations: result.segments,
        })),
      };
    } finally {
      if (chunksDir) {
        await rm(chunksDir, { force: true, recursive: true });
      }
    }
  }
}

export const transcriptionProvider = new QwenTranscriptionProvider();
