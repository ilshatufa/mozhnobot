-- CreateEnum
CREATE TYPE "VpnBillingSubscriptionStatus" AS ENUM ('CREATED', 'ACTIVE', 'CANCELED', 'FAILED', 'ENDED');

-- CreateEnum
CREATE TYPE "VpnPaymentStatus" AS ENUM ('PAID', 'REFUNDED');

-- CreateTable
CREATE TABLE "vpn_billing_subscriptions" (
    "id" SERIAL NOT NULL,
    "vpn_subscription_id" INTEGER NOT NULL,
    "invoice_payload" VARCHAR(128) NOT NULL,
    "status" "VpnBillingSubscriptionStatus" NOT NULL DEFAULT 'CREATED',
    "currency" VARCHAR(3) NOT NULL,
    "amount_stars" INTEGER NOT NULL,
    "period_seconds" INTEGER NOT NULL,
    "product_code" VARCHAR(80) NOT NULL,
    "terms_version" VARCHAR(80) NOT NULL,
    "terms_accepted_at" TIMESTAMPTZ NOT NULL,
    "telegram_subscription_charge_id" VARCHAR(255),
    "activated_at" TIMESTAMPTZ,
    "state_updated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vpn_payments" (
    "id" SERIAL NOT NULL,
    "billing_subscription_id" INTEGER NOT NULL,
    "telegram_payment_charge_id" VARCHAR(255) NOT NULL,
    "provider_payment_charge_id" VARCHAR(255),
    "status" "VpnPaymentStatus" NOT NULL DEFAULT 'PAID',
    "currency" VARCHAR(3) NOT NULL,
    "amount_stars" INTEGER NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "is_first_recurring" BOOLEAN NOT NULL DEFAULT false,
    "subscription_expiration_date" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "refunded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vpn_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vpn_billing_subscriptions_invoice_payload_key" ON "vpn_billing_subscriptions"("invoice_payload");

-- CreateIndex
CREATE UNIQUE INDEX "vpn_billing_subscriptions_telegram_subscription_charge_id_key" ON "vpn_billing_subscriptions"("telegram_subscription_charge_id");

-- CreateIndex
CREATE INDEX "vpn_billing_subscriptions_vpn_subscription_id_status_idx" ON "vpn_billing_subscriptions"("vpn_subscription_id", "status");

-- CreateIndex
CREATE INDEX "vpn_billing_subscriptions_status_created_at_idx" ON "vpn_billing_subscriptions"("status", "created_at");

-- Enforce one current billing agreement per VPN subscription. Historical
-- agreements remain available after they transition to ENDED.
CREATE UNIQUE INDEX "vpn_billing_subscriptions_one_current_idx"
ON "vpn_billing_subscriptions"("vpn_subscription_id")
WHERE "status" IN ('CREATED', 'ACTIVE', 'CANCELED', 'FAILED');

-- CreateIndex
CREATE UNIQUE INDEX "vpn_payments_telegram_payment_charge_id_key" ON "vpn_payments"("telegram_payment_charge_id");

-- CreateIndex
CREATE INDEX "vpn_payments_billing_subscription_id_paid_at_idx" ON "vpn_payments"("billing_subscription_id", "paid_at");

-- CreateIndex
CREATE INDEX "vpn_payments_status_paid_at_idx" ON "vpn_payments"("status", "paid_at");

-- AddForeignKey
ALTER TABLE "vpn_billing_subscriptions" ADD CONSTRAINT "vpn_billing_subscriptions_vpn_subscription_id_fkey" FOREIGN KEY ("vpn_subscription_id") REFERENCES "vpn_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vpn_payments" ADD CONSTRAINT "vpn_payments_billing_subscription_id_fkey" FOREIGN KEY ("billing_subscription_id") REFERENCES "vpn_billing_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
