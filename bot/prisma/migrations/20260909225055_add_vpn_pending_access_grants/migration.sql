-- CreateTable
CREATE TABLE "vpn_pending_access_grants" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "normalized_username" VARCHAR(32) NOT NULL,
    "granted_by_telegram_id" BIGINT NOT NULL,
    "claimed_by_user_id" INTEGER,
    "claimed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_pending_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vpn_pending_access_grants_normalized_username_key" ON "vpn_pending_access_grants"("normalized_username");

-- CreateIndex
CREATE INDEX "vpn_pending_access_grants_claimed_at_idx" ON "vpn_pending_access_grants"("claimed_at");
