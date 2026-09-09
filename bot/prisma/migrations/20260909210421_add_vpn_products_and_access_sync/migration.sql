/*
  Warnings:

  - A unique constraint covering the columns `[subscription_id,server_id]` on the table `vpn_keys` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VpnProductAccessPolicy" AS ENUM ('CLUB_MEMBERSHIP', 'PAID_BALANCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "VpnSubscriptionStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "VpnSubscriptionInboundStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'ERROR', 'DISABLED');

-- AlterTable
ALTER TABLE "vpn_keys" ADD COLUMN     "subscription_id" INTEGER;

-- CreateTable
CREATE TABLE "vpn_products" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "access_policy" "VpnProductAccessPolicy" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_inbounds" (
    "id" SERIAL NOT NULL,
    "server_id" INTEGER NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "provider_inbound_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL,
    "public_profile" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_inbounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_product_inbounds" (
    "product_id" INTEGER NOT NULL,
    "inbound_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_product_inbounds_pkey" PRIMARY KEY ("product_id","inbound_id")
);

-- CreateTable
CREATE TABLE "vpn_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "status" "VpnSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ,
    "applied_revision" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_subscription_inbounds" (
    "subscription_id" INTEGER NOT NULL,
    "inbound_id" INTEGER NOT NULL,
    "key_id" INTEGER,
    "status" "VpnSubscriptionInboundStatus" NOT NULL DEFAULT 'PENDING',
    "last_attempt_at" TIMESTAMPTZ,
    "last_synced_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_subscription_inbounds_pkey" PRIMARY KEY ("subscription_id","inbound_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vpn_products_code_key" ON "vpn_products"("code");

-- CreateIndex
CREATE INDEX "vpn_products_access_policy_is_active_idx" ON "vpn_products"("access_policy", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_inbounds_code_key" ON "vpn_inbounds"("code");

-- CreateIndex
CREATE INDEX "vpn_inbounds_server_id_is_active_idx" ON "vpn_inbounds"("server_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_inbounds_server_id_provider_inbound_id_key" ON "vpn_inbounds"("server_id", "provider_inbound_id");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_product_inbounds_product_id_position_key" ON "vpn_product_inbounds"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_subscriptions_token_key" ON "vpn_subscriptions"("token");

-- CreateIndex
CREATE INDEX "vpn_subscriptions_product_id_status_idx" ON "vpn_subscriptions"("product_id", "status");

-- CreateIndex
CREATE INDEX "vpn_subscriptions_status_expires_at_idx" ON "vpn_subscriptions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_subscriptions_user_id_product_id_key" ON "vpn_subscriptions"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "vpn_subscription_inbounds_inbound_id_status_idx" ON "vpn_subscription_inbounds"("inbound_id", "status");

-- CreateIndex
CREATE INDEX "vpn_subscription_inbounds_key_id_idx" ON "vpn_subscription_inbounds"("key_id");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_keys_subscription_id_server_id_key" ON "vpn_keys"("subscription_id", "server_id");

-- AddForeignKey
ALTER TABLE "vpn_keys" ADD CONSTRAINT "vpn_keys_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "vpn_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_inbounds" ADD CONSTRAINT "vpn_inbounds_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "vpn_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_product_inbounds" ADD CONSTRAINT "vpn_product_inbounds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "vpn_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_product_inbounds" ADD CONSTRAINT "vpn_product_inbounds_inbound_id_fkey" FOREIGN KEY ("inbound_id") REFERENCES "vpn_inbounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_subscriptions" ADD CONSTRAINT "vpn_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_subscriptions" ADD CONSTRAINT "vpn_subscriptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "vpn_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_subscription_inbounds" ADD CONSTRAINT "vpn_subscription_inbounds_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "vpn_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_subscription_inbounds" ADD CONSTRAINT "vpn_subscription_inbounds_inbound_id_fkey" FOREIGN KEY ("inbound_id") REFERENCES "vpn_inbounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_subscription_inbounds" ADD CONSTRAINT "vpn_subscription_inbounds_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "vpn_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
