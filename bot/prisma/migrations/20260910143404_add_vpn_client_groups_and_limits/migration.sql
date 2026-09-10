/*
  Warnings:

  - A unique constraint covering the columns `[subscription_id,server_id,client_group]` on the table `vpn_keys` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "vpn_keys_subscription_id_server_id_key";

-- AlterTable
ALTER TABLE "vpn_keys" ADD COLUMN     "client_group" VARCHAR(40) NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "vpn_product_inbounds" ADD COLUMN     "client_group" VARCHAR(40) NOT NULL DEFAULT 'default',
ADD COLUMN     "traffic_limit_bytes" BIGINT,
ADD COLUMN     "traffic_reset_days" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "vpn_keys_subscription_id_server_id_client_group_key" ON "vpn_keys"("subscription_id", "server_id", "client_group");
