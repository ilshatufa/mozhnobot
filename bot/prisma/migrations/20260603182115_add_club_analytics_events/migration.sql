-- CreateEnum
CREATE TYPE "ClubMembershipStatus" AS ENUM ('UNKNOWN', 'JOIN_REQUESTED', 'MEMBER', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "BotInteractionStatus" AS ENUM ('UNKNOWN', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ClubTopicStatus" AS ENUM ('ACTIVE', 'CLOSED', 'HIDDEN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bot_blocked_at" TIMESTAMPTZ,
ADD COLUMN     "bot_started_at" TIMESTAMPTZ,
ADD COLUMN     "bot_status" "BotInteractionStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "club_status" "ClubMembershipStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "first_seen_at" TIMESTAMPTZ,
ADD COLUMN     "is_bot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "joined_at" TIMESTAMPTZ,
ADD COLUMN     "last_name" VARCHAR(255),
ADD COLUMN     "last_seen_at" TIMESTAMPTZ,
ADD COLUMN     "left_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "club_topics" (
    "id" SERIAL NOT NULL,
    "chat_telegram_id" BIGINT NOT NULL,
    "telegram_message_thread_id" INTEGER NOT NULL,
    "name" VARCHAR(255),
    "status" "ClubTopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_message_index" (
    "id" SERIAL NOT NULL,
    "chat_telegram_id" BIGINT NOT NULL,
    "telegram_message_id" INTEGER NOT NULL,
    "telegram_message_thread_id" INTEGER,
    "author_telegram_id" BIGINT,
    "reply_to_telegram_message_id" INTEGER,
    "message_type" VARCHAR(50) NOT NULL,
    "text" TEXT,
    "caption" TEXT,
    "text_length" INTEGER,
    "caption_length" INTEGER,
    "posted_at" TIMESTAMPTZ NOT NULL,
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_message_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_events" (
    "id" SERIAL NOT NULL,
    "telegram_update_id" BIGINT,
    "dedupe_key" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "chat_telegram_id" BIGINT,
    "telegram_message_thread_id" INTEGER,
    "user_telegram_id" BIGINT,
    "message_telegram_id" INTEGER,
    "target_user_telegram_id" BIGINT,
    "target_message_telegram_id" INTEGER,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_topics_status_idx" ON "club_topics"("status");

-- CreateIndex
CREATE INDEX "club_topics_chat_telegram_id_idx" ON "club_topics"("chat_telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_topics_chat_telegram_id_telegram_message_thread_id_key" ON "club_topics"("chat_telegram_id", "telegram_message_thread_id");

-- CreateIndex
CREATE INDEX "club_message_index_author_telegram_id_posted_at_idx" ON "club_message_index"("author_telegram_id", "posted_at");

-- CreateIndex
CREATE INDEX "club_message_index_telegram_message_thread_id_posted_at_idx" ON "club_message_index"("telegram_message_thread_id", "posted_at");

-- CreateIndex
CREATE INDEX "club_message_index_reply_to_telegram_message_id_idx" ON "club_message_index"("reply_to_telegram_message_id");

-- CreateIndex
CREATE INDEX "club_message_index_posted_at_idx" ON "club_message_index"("posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "club_message_index_chat_telegram_id_telegram_message_id_key" ON "club_message_index"("chat_telegram_id", "telegram_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_events_dedupe_key_key" ON "club_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "club_events_event_type_occurred_at_idx" ON "club_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "club_events_user_telegram_id_occurred_at_idx" ON "club_events"("user_telegram_id", "occurred_at");

-- CreateIndex
CREATE INDEX "club_events_chat_telegram_id_occurred_at_idx" ON "club_events"("chat_telegram_id", "occurred_at");

-- CreateIndex
CREATE INDEX "club_events_telegram_message_thread_id_occurred_at_idx" ON "club_events"("telegram_message_thread_id", "occurred_at");

-- CreateIndex
CREATE INDEX "club_events_target_user_telegram_id_occurred_at_idx" ON "club_events"("target_user_telegram_id", "occurred_at");

-- CreateIndex
CREATE INDEX "club_events_message_telegram_id_idx" ON "club_events"("message_telegram_id");

-- CreateIndex
CREATE INDEX "club_events_target_message_telegram_id_occurred_at_idx" ON "club_events"("target_message_telegram_id", "occurred_at");

-- CreateIndex
CREATE INDEX "users_club_status_idx" ON "users"("club_status");

-- CreateIndex
CREATE INDEX "users_bot_status_idx" ON "users"("bot_status");

-- CreateIndex
CREATE INDEX "users_last_seen_at_idx" ON "users"("last_seen_at");
