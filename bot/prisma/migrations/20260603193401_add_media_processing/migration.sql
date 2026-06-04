-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'DOWNLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "club_media" (
    "id" SERIAL NOT NULL,
    "message_index_id" INTEGER NOT NULL,
    "chat_telegram_id" BIGINT NOT NULL,
    "telegram_message_id" INTEGER NOT NULL,
    "media_type" VARCHAR(50) NOT NULL,
    "telegram_file_id" VARCHAR(255) NOT NULL,
    "telegram_file_unique_id" VARCHAR(255),
    "duration_seconds" INTEGER,
    "file_size" INTEGER,
    "mime_type" VARCHAR(255),
    "title" VARCHAR(255),
    "performer" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_processing_jobs" (
    "id" SERIAL NOT NULL,
    "media_id" INTEGER NOT NULL,
    "status" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "downloaded_file_path" TEXT,
    "transcript_raw" TEXT,
    "transcript_clean" TEXT,
    "transcript_language" VARCHAR(32),
    "transcript_segments" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "media_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_media_message_index_id_idx" ON "club_media"("message_index_id");

-- CreateIndex
CREATE INDEX "club_media_telegram_file_unique_id_idx" ON "club_media"("telegram_file_unique_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_media_chat_telegram_id_telegram_message_id_media_type_key" ON "club_media"("chat_telegram_id", "telegram_message_id", "media_type");

-- CreateIndex
CREATE UNIQUE INDEX "media_processing_jobs_media_id_key" ON "media_processing_jobs"("media_id");

-- CreateIndex
CREATE INDEX "media_processing_jobs_status_created_at_idx" ON "media_processing_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "media_processing_jobs_media_id_idx" ON "media_processing_jobs"("media_id");
