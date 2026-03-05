-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" VARCHAR(255),
    "first_name" VARCHAR(255),
    "role" "Role" NOT NULL DEFAULT 'USER',
    "vpn_blocked" BOOLEAN NOT NULL DEFAULT false,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "banned_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_keys" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "xui_client_id" VARCHAR(255) NOT NULL,
    "subscription_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vpn_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE INDEX "vpn_keys_user_id_is_active_idx" ON "vpn_keys"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "vpn_keys_expires_at_idx" ON "vpn_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "vpn_keys" ADD CONSTRAINT "vpn_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
