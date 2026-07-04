-- AlterTable
ALTER TABLE "users" ADD COLUMN     "vpn_duration_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "vpn_traffic_limit_bytes" BIGINT DEFAULT 30000000000;
