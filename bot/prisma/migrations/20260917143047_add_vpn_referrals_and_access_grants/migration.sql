/*
  Warnings:

  - A unique constraint covering the columns `[paid_vpn_referral_code]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VpnAccessGrantType" AS ENUM ('ADMIN_GIFT', 'REFERRAL_REWARD');

-- CreateEnum
CREATE TYPE "VpnAccessGrantStatus" AS ENUM ('PENDING', 'APPLIED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VpnReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REJECTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "paid_vpn_referral_code" VARCHAR(24),
ADD COLUMN     "paid_vpn_started_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "vpn_access_grants" (
    "id" SERIAL NOT NULL,
    "vpn_subscription_id" INTEGER NOT NULL,
    "type" "VpnAccessGrantType" NOT NULL,
    "status" "VpnAccessGrantStatus" NOT NULL DEFAULT 'APPLIED',
    "duration_seconds" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "source_referral_id" INTEGER,
    "granted_by_telegram_id" BIGINT,
    "quota_reset_required" BOOLEAN NOT NULL DEFAULT false,
    "quota_reset_at" TIMESTAMPTZ,
    "quota_reset_error" TEXT,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_referrals" (
    "id" SERIAL NOT NULL,
    "inviter_user_id" INTEGER NOT NULL,
    "invited_user_id" INTEGER NOT NULL,
    "status" "VpnReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualifying_payment_id" INTEGER,
    "qualified_at" TIMESTAMPTZ,
    "rewarded_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vpn_access_grants_idempotency_key_key" ON "vpn_access_grants"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_access_grants_source_referral_id_key" ON "vpn_access_grants"("source_referral_id");

-- CreateIndex
CREATE INDEX "vpn_access_grants_vpn_subscription_id_status_idx" ON "vpn_access_grants"("vpn_subscription_id", "status");

-- CreateIndex
CREATE INDEX "vpn_access_grants_status_created_at_idx" ON "vpn_access_grants"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_referrals_invited_user_id_key" ON "vpn_referrals"("invited_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_referrals_qualifying_payment_id_key" ON "vpn_referrals"("qualifying_payment_id");

-- CreateIndex
CREATE INDEX "vpn_referrals_inviter_user_id_status_idx" ON "vpn_referrals"("inviter_user_id", "status");

-- CreateIndex
CREATE INDEX "vpn_referrals_status_created_at_idx" ON "vpn_referrals"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_paid_vpn_referral_code_key" ON "users"("paid_vpn_referral_code");

-- AddForeignKey
ALTER TABLE "vpn_access_grants" ADD CONSTRAINT "vpn_access_grants_vpn_subscription_id_fkey" FOREIGN KEY ("vpn_subscription_id") REFERENCES "vpn_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_access_grants" ADD CONSTRAINT "vpn_access_grants_source_referral_id_fkey" FOREIGN KEY ("source_referral_id") REFERENCES "vpn_referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_referrals" ADD CONSTRAINT "vpn_referrals_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_referrals" ADD CONSTRAINT "vpn_referrals_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_referrals" ADD CONSTRAINT "vpn_referrals_qualifying_payment_id_fkey" FOREIGN KEY ("qualifying_payment_id") REFERENCES "vpn_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
