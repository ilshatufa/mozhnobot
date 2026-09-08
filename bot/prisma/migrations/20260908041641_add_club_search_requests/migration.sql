-- CreateEnum
CREATE TYPE "ClubSearchRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "club_search_requests" (
    "id" UUID NOT NULL,
    "requester_telegram_id" BIGINT NOT NULL,
    "telegram_chat_id" BIGINT NOT NULL,
    "progress_message_id" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "status" "ClubSearchRequestStatus" NOT NULL DEFAULT 'PENDING',
    "active_key" VARCHAR(32),
    "progress_stage" INTEGER NOT NULL DEFAULT 0,
    "answer" TEXT,
    "source_message_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "error_code" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_search_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_search_requests_active_key_key" ON "club_search_requests"("active_key");

-- CreateIndex
CREATE INDEX "club_search_requests_status_created_at_idx" ON "club_search_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "club_search_requests_requester_telegram_id_created_at_idx" ON "club_search_requests"("requester_telegram_id", "created_at");

-- CreateIndex
CREATE INDEX "club_search_requests_status_delivered_at_idx" ON "club_search_requests"("status", "delivered_at");
