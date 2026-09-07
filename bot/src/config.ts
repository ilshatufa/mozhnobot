import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  CLUB_GROUP_ID: z.string().min(1),
  SEED_ADMIN_ID: z.string().min(1),

  XUI_BASE_URL: z.string().url(),
  XUI_SUB_BASE_URL: z.string().url(),
  XUI_USERNAME: z.string().min(1),
  XUI_PASSWORD: z.string().min(1),
  XUI_INBOUND_ID: z.coerce.number().int().positive(),

  DATABASE_URL: z.string().min(1),

  VPN_SETUP_IMAGE_FILE_ID: z.string().min(1),
  VPN_SETUP_IMAGE_FILE_ID_2: z.string().optional().default(""),

  MEDIA_PROCESSING_ENABLED: z.coerce.boolean().default(true),
  MEDIA_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  MEDIA_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(50),
  MEDIA_DOWNLOAD_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  MEDIA_CONVERSION_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  MEDIA_IN_PROGRESS_STALE_MS: z.coerce.number().int().positive().default(600000),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  MEDIA_FAILED_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  MEDIA_STORAGE_DIR: z.string().min(1).default("/app/media"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default("gpt-4o-mini-transcribe"),
  OPENAI_TRANSCRIPTION_LANGUAGE: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_PROMPT: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(25),
  OPENAI_TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENAI_TRANSCRIPT_CLEANUP_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_TRANSCRIPT_CLEANUP_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  botToken: parsed.data.BOT_TOKEN,
  clubGroupId: parsed.data.CLUB_GROUP_ID,
  seedAdminId: BigInt(parsed.data.SEED_ADMIN_ID),

  xui: {
    baseUrl: parsed.data.XUI_BASE_URL,
    subBaseUrl: parsed.data.XUI_SUB_BASE_URL,
    username: parsed.data.XUI_USERNAME,
    password: parsed.data.XUI_PASSWORD,
    inboundId: parsed.data.XUI_INBOUND_ID,
  },

  vpnSetupImageFileId: parsed.data.VPN_SETUP_IMAGE_FILE_ID,
  vpnSetupImageFileId2: parsed.data.VPN_SETUP_IMAGE_FILE_ID_2,

  media: {
    processingEnabled: parsed.data.MEDIA_PROCESSING_ENABLED,
    workerIntervalMs: parsed.data.MEDIA_WORKER_INTERVAL_MS,
    maxFileSizeMb: parsed.data.MEDIA_MAX_FILE_SIZE_MB,
    downloadMaxAttempts: parsed.data.MEDIA_DOWNLOAD_MAX_ATTEMPTS,
    conversionTimeoutMs: parsed.data.MEDIA_CONVERSION_TIMEOUT_MS,
    inProgressStaleMs: parsed.data.MEDIA_IN_PROGRESS_STALE_MS,
    retentionDays: parsed.data.MEDIA_RETENTION_DAYS,
    failedRetentionDays: parsed.data.MEDIA_FAILED_RETENTION_DAYS,
    storageDir: parsed.data.MEDIA_STORAGE_DIR,
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    openaiTranscriptionModel: parsed.data.OPENAI_TRANSCRIPTION_MODEL,
    openaiTranscriptionLanguage: parsed.data.OPENAI_TRANSCRIPTION_LANGUAGE,
    openaiTranscriptionPrompt: parsed.data.OPENAI_TRANSCRIPTION_PROMPT,
    openaiTranscriptionMaxFileSizeMb: parsed.data.OPENAI_TRANSCRIPTION_MAX_FILE_SIZE_MB,
    openaiTranscriptionTimeoutMs: parsed.data.OPENAI_TRANSCRIPTION_TIMEOUT_MS,
    openaiTranscriptCleanupModel: parsed.data.OPENAI_TRANSCRIPT_CLEANUP_MODEL,
    openaiTranscriptCleanupTimeoutMs: parsed.data.OPENAI_TRANSCRIPT_CLEANUP_TIMEOUT_MS,
  },
} as const;
