import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  VpnBillingSubscriptionStatus,
  VpnProductAccessPolicy,
  VpnSubscriptionAccessOverride,
} from "@prisma/client";
import { prisma } from "../database.js";
import { vpnSubscriptionRepository } from "../repositories/vpn-subscription.repository.js";
import {
  VPN_STARS_CURRENCY,
  VPN_SUBSCRIPTION_PERIOD_SECONDS,
  vpnBillingService,
} from "./vpn-billing.service.js";

const integrationDatabaseUrl = process.env.VPN_ACCESS_INTEGRATION_DATABASE_URL;

test("records Stars payments, trusts Telegram expiration, and preserves paid time across free access", {
  skip: integrationDatabaseUrl ? false : "VPN access integration database is not configured",
}, async () => {
  await prisma.$connect();
  let userId: number | null = null;
  let subscriptionId: number | null = null;
  try {
    const product = await prisma.vpnProduct.upsert({
      where: { code: "paid" },
      create: {
        code: "paid",
        name: "МОЖНО VPN",
        accessPolicy: VpnProductAccessPolicy.PAID_BALANCE,
      },
      update: {
        isActive: true,
        accessPolicy: VpnProductAccessPolicy.PAID_BALANCE,
      },
    });
    const user = await prisma.user.create({
      data: {
        telegramId: BigInt(`8${Date.now()}`),
        username: `billing_${randomUUID().slice(0, 8)}`,
      },
    });
    userId = user.id;

    const invoiceInput = {
      userId: user.id,
      amountStars: 100,
      termsVersion: "test-v1",
      acceptedAt: new Date("2026-09-17T08:00:00Z"),
      now: new Date("2026-09-17T08:00:00Z"),
    };
    const [invoice, concurrentInvoice] = await Promise.all([
      vpnBillingService.createInvoice(invoiceInput),
      vpnBillingService.createInvoice(invoiceInput),
    ]);
    if (invoice.accessAlreadyAvailable) assert.fail("Expected a new billing subscription");
    if (concurrentInvoice.accessAlreadyAvailable) assert.fail("Expected the current invoice");
    assert.equal(concurrentInvoice.billingSubscription.id, invoice.billingSubscription.id);
    const billingSubscription = invoice.billingSubscription;
    const vpnSubscription = await prisma.vpnSubscription.findUniqueOrThrow({
      where: { id: billingSubscription.vpnSubscriptionId },
    });
    subscriptionId = vpnSubscription.id;
    assert.equal(vpnSubscription.productId, product.id);
    assert.equal(invoice.accessAlreadyAvailable, false);
    assert.equal(billingSubscription.amountStars, 100);
    assert.equal(billingSubscription.periodSeconds, VPN_SUBSCRIPTION_PERIOD_SECONDS);

    const checkout = await vpnBillingService.validateCheckout({
      telegramId: user.telegramId,
      invoicePayload: billingSubscription.invoicePayload,
      currency: VPN_STARS_CURRENCY,
      totalAmount: 100,
      configuredAmountStars: 100,
      configuredTermsVersion: "test-v1",
      salesAllowed: true,
    });
    assert.equal(checkout.ok, true);

    const replacementInvoice = await vpnBillingService.createInvoice({
      userId: user.id,
      amountStars: 100,
      termsVersion: "test-v2",
      acceptedAt: new Date("2026-09-17T08:03:00Z"),
      now: new Date("2026-09-17T08:03:00Z"),
    });
    if (replacementInvoice.accessAlreadyAvailable) assert.fail("Expected a replacement invoice");
    assert.notEqual(replacementInvoice.billingSubscription.id, billingSubscription.id);
    assert.equal(
      (await prisma.vpnBillingSubscription.findUniqueOrThrow({
        where: { id: billingSubscription.id },
      })).status,
      VpnBillingSubscriptionStatus.ENDED,
    );

    const paidAt = new Date("2026-09-17T08:05:00Z");
    const expiresAt = new Date("2026-10-17T08:05:00Z");
    const paymentInput = {
      telegramId: user.telegramId,
      invoicePayload: billingSubscription.invoicePayload,
      telegramPaymentChargeId: `charge_${randomUUID()}`,
      providerPaymentChargeId: null,
      currency: VPN_STARS_CURRENCY,
      totalAmount: 100,
      isRecurring: true,
      isFirstRecurring: true,
      subscriptionExpirationDate: expiresAt,
      paidAt,
    };
    const recorded = await vpnBillingService.recordSuccessfulPayment(paymentInput);
    assert.equal(recorded.duplicate, false);
    assert.equal(recorded.subscription.expiresAt?.toISOString(), expiresAt.toISOString());
    assert.equal(
      (await prisma.vpnBillingSubscription.findUniqueOrThrow({
        where: { id: replacementInvoice.billingSubscription.id },
      })).status,
      VpnBillingSubscriptionStatus.ENDED,
    );

    const duplicate = await vpnBillingService.recordSuccessfulPayment(paymentInput);
    assert.equal(duplicate.duplicate, true);
    assert.equal(await prisma.vpnPayment.count({
      where: { telegramPaymentChargeId: paymentInput.telegramPaymentChargeId },
    }), 1);
    await assert.rejects(
      vpnBillingService.recordSuccessfulPayment({
        ...paymentInput,
        totalAmount: 101,
      }),
      /does not match/,
    );

    const renewedExpiration = new Date("2026-11-17T08:05:00Z");
    await vpnBillingService.recordSuccessfulPayment({
      ...paymentInput,
      telegramPaymentChargeId: `charge_${randomUUID()}`,
      isFirstRecurring: false,
      subscriptionExpirationDate: renewedExpiration,
      paidAt: new Date("2026-10-17T08:05:00Z"),
    });
    await vpnBillingService.recordSuccessfulPayment({
      ...paymentInput,
      telegramPaymentChargeId: `charge_${randomUUID()}`,
      isFirstRecurring: false,
      subscriptionExpirationDate: new Date("2026-10-20T08:05:00Z"),
      paidAt: new Date("2026-09-20T08:05:00Z"),
    });
    assert.equal(
      (await prisma.vpnSubscription.findUniqueOrThrow({ where: { id: vpnSubscription.id } }))
        .expiresAt?.toISOString(),
      renewedExpiration.toISOString(),
    );

    const checkoutAfterPayment = await vpnBillingService.validateCheckout({
      telegramId: user.telegramId,
      invoicePayload: billingSubscription.invoicePayload,
      currency: VPN_STARS_CURRENCY,
      totalAmount: 100,
      configuredAmountStars: 100,
      configuredTermsVersion: "test-v1",
      salesAllowed: true,
    });
    assert.equal(checkoutAfterPayment.ok, false);
    assert.match(checkoutAfterPayment.reason ?? "", /Доступ уже подключён/);

    const invoiceWhilePaid = await vpnBillingService.createInvoice({
      userId: user.id,
      amountStars: 100,
      termsVersion: "test-v1",
      acceptedAt: new Date("2026-09-17T08:10:00Z"),
      now: new Date("2026-09-17T08:10:00Z"),
    });
    assert.equal(invoiceWhilePaid.accessAlreadyAvailable, true);
    assert.ok(invoiceWhilePaid.billingSubscription);
    assert.equal(invoiceWhilePaid.billingSubscription.id, billingSubscription.id);

    await vpnBillingService.updateTelegramSubscriptionState({
      telegramId: user.telegramId,
      invoicePayload: billingSubscription.invoicePayload,
      state: "canceled",
      occurredAt: new Date("2026-09-18T08:00:00Z"),
    });
    assert.equal(
      (await prisma.vpnSubscription.findUniqueOrThrow({ where: { id: vpnSubscription.id } }))
        .expiresAt?.toISOString(),
      renewedExpiration.toISOString(),
    );

    const granted = await vpnSubscriptionRepository.grantFreeUnlimited(
      user.id,
      "paid",
      randomUUID(),
    );
    assert.equal(granted.subscription.accessOverride, VpnSubscriptionAccessOverride.FREE_UNLIMITED);
    assert.equal(granted.subscription.expiresAt?.toISOString(), renewedExpiration.toISOString());
    const invoiceWhileFree = await vpnBillingService.createInvoice({
      userId: user.id,
      amountStars: 100,
      termsVersion: "test-v1",
      acceptedAt: new Date("2026-09-18T08:10:00Z"),
      now: new Date("2026-10-18T08:10:00Z"),
    });
    assert.equal(invoiceWhileFree.accessAlreadyAvailable, true);
    const revoked = await vpnSubscriptionRepository.revokeFreeUnlimited(user.id, "paid");
    assert.equal(revoked.subscription?.expiresAt?.toISOString(), renewedExpiration.toISOString());
  } finally {
    if (subscriptionId !== null) {
      const billingIds = await prisma.vpnBillingSubscription.findMany({
        where: { vpnSubscriptionId: subscriptionId },
        select: { id: true },
      });
      await prisma.vpnPayment.deleteMany({
        where: { billingSubscriptionId: { in: billingIds.map((item) => item.id) } },
      });
      await prisma.vpnBillingSubscription.deleteMany({ where: { vpnSubscriptionId: subscriptionId } });
      await prisma.vpnSubscription.deleteMany({ where: { id: subscriptionId } });
    }
    if (userId !== null) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
