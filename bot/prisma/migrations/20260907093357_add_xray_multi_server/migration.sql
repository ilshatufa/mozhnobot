-- CreateEnum
CREATE TYPE "VpnProvider" AS ENUM ('XUI');

-- DropIndex
DROP INDEX "vpn_keys_user_id_is_active_idx";

-- AlterTable
ALTER TABLE "vpn_keys" ADD COLUMN     "last_synced_at" TIMESTAMPTZ,
ADD COLUMN     "provider" "VpnProvider" NOT NULL DEFAULT 'XUI',
ADD COLUMN     "provider_client_id" VARCHAR(255),
ADD COLUMN     "provider_peer_id" VARCHAR(255),
ADD COLUMN     "server_id" INTEGER,
ADD COLUMN     "traffic_used_bytes" BIGINT;

-- CreateTable
CREATE TABLE "vpn_servers" (
    "id" SERIAL NOT NULL,
    "provider" "VpnProvider" NOT NULL DEFAULT 'XUI',
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "api_base_url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vpn_servers_code_key" ON "vpn_servers"("code");

-- CreateIndex
CREATE INDEX "vpn_servers_provider_is_active_idx" ON "vpn_servers"("provider", "is_active");

-- CreateIndex
CREATE INDEX "vpn_keys_user_id_server_id_is_active_idx" ON "vpn_keys"("user_id", "server_id", "is_active");

-- CreateIndex
CREATE INDEX "vpn_keys_provider_is_active_idx" ON "vpn_keys"("provider", "is_active");

-- AddForeignKey
ALTER TABLE "vpn_keys" ADD CONSTRAINT "vpn_keys_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "vpn_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
