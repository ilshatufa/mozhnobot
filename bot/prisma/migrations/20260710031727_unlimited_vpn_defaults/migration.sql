-- AlterTable
ALTER TABLE "users" ALTER COLUMN "vpn_duration_days" SET DEFAULT 0,
ALTER COLUMN "vpn_traffic_limit_bytes" DROP DEFAULT;
