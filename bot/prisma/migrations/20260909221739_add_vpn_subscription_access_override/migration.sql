-- CreateEnum
CREATE TYPE "VpnSubscriptionAccessOverride" AS ENUM ('NONE', 'FREE_UNLIMITED');

-- AlterTable
ALTER TABLE "vpn_subscriptions" ADD COLUMN     "access_override" "VpnSubscriptionAccessOverride" NOT NULL DEFAULT 'NONE';
