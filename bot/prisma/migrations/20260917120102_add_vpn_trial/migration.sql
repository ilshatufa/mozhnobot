-- CreateEnum
CREATE TYPE "VpnTrialStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'EXPIRED', 'CONVERTED');

-- AlterTable
ALTER TABLE "vpn_payments" ADD COLUMN     "quota_reset_at" TIMESTAMPTZ,
ADD COLUMN     "quota_reset_error" TEXT;

-- CreateTable
CREATE TABLE "vpn_trials" (
    "id" SERIAL NOT NULL,
    "vpn_subscription_id" INTEGER NOT NULL,
    "status" "VpnTrialStatus" NOT NULL DEFAULT 'PROVISIONING',
    "terms_version" VARCHAR(80) NOT NULL,
    "terms_accepted_at" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "converted_at" TIMESTAMPTZ,
    "ending_soon_notified_at" TIMESTAMPTZ,
    "expired_notified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_trials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vpn_trials_vpn_subscription_id_key" ON "vpn_trials"("vpn_subscription_id");

-- CreateIndex
CREATE INDEX "vpn_trials_status_ends_at_idx" ON "vpn_trials"("status", "ends_at");

-- AddForeignKey
ALTER TABLE "vpn_trials" ADD CONSTRAINT "vpn_trials_vpn_subscription_id_fkey" FOREIGN KEY ("vpn_subscription_id") REFERENCES "vpn_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
