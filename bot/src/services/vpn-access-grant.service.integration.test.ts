import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  ClubMembershipStatus,
  VpnAccessGrantStatus,
  VpnProductAccessPolicy,
  VpnReferralStatus,
  VpnTrialStatus,
} from "@prisma/client";
import { prisma } from "../database.js";
import {
  VPN_STARS_CURRENCY,
  VPN_SUBSCRIPTION_PERIOD_SECONDS,
  vpnBillingService,
} from "./vpn-billing.service.js";
import { vpnAccessGrantService } from "./vpn-access-grant.service.js";

const integrationDatabaseUrl = process.env.VPN_ACCESS_INTEGRATION_DATABASE_URL;

test("accepts only a new referral, rewards first payment, and banks days for club access", {
  skip: integrationDatabaseUrl ? false : "VPN access integration database is not configured",
}, async () => {
  await prisma.$connect();
  const userIds: number[] = [];
  try {
    await prisma.vpnProduct.upsert({
      where: { code: "paid" },
      create: {
        code: "paid",
        name: "МОЖНО VPN",
        accessPolicy: VpnProductAccessPolicy.PAID_BALANCE,
      },
      update: { isActive: true, accessPolicy: VpnProductAccessPolicy.PAID_BALANCE },
    });
    const inviter = await prisma.user.create({
      data: {
        telegramId: BigInt(`7${Date.now()}`),
        username: `inviter_${randomUUID().slice(0, 8)}`,
        paidVpnStartedAt: new Date("2026-09-01T00:00:00Z"),
        clubStatus: ClubMembershipStatus.MEMBER,
      },
    });
    const invited = await prisma.user.create({
      data: {
        telegramId: BigInt(`6${Date.now()}`),
        username: `invited_${randomUUID().slice(0, 8)}`,
      },
    });
    userIds.push(inviter.id, invited.id);
    const code = await vpnAccessGrantService.ensureReferralCode(inviter.id);
    const accepted = await vpnAccessGrantService.registerStart(
      invited.id,
      `ref_${code}`,
      new Date("2026-09-17T08:00:00Z"),
    );
    assert.deepEqual(accepted, { status: "REFERRAL_ACCEPTED", inviterUserId: inviter.id });
    assert.deepEqual(
      await vpnAccessGrantService.registerStart(invited.id, `ref_${code}`),
      { status: "ALREADY_STARTED" },
    );

    const invoice = await vpnBillingService.createInvoice({
      userId: invited.id,
      amountStars: 100,
      termsVersion: "test-v1",
      acceptedAt: new Date("2026-09-17T08:01:00Z"),
    });
    if (invoice.accessAlreadyAvailable) assert.fail("Expected a new invoice");
    await prisma.vpnTrial.create({
      data: {
        vpnSubscriptionId: invoice.billingSubscription.vpnSubscriptionId,
        status: VpnTrialStatus.ACTIVE,
        termsVersion: "test-v1",
        termsAcceptedAt: new Date("2026-09-17T08:00:00Z"),
        startedAt: new Date("2026-09-17T08:00:00Z"),
        endsAt: new Date("2026-09-24T08:00:00Z"),
      },
    });
    const paidAt = new Date("2026-09-18T08:00:00Z");
    const payment = await vpnBillingService.recordSuccessfulPayment({
      telegramId: invited.telegramId,
      invoicePayload: invoice.billingSubscription.invoicePayload,
      telegramPaymentChargeId: `charge_${randomUUID()}`,
      providerPaymentChargeId: null,
      currency: VPN_STARS_CURRENCY,
      totalAmount: 100,
      isRecurring: true,
      isFirstRecurring: true,
      subscriptionExpirationDate: new Date(paidAt.getTime() + VPN_SUBSCRIPTION_PERIOD_SECONDS * 1000),
      paidAt,
    });
    const reward = await vpnAccessGrantService.rewardReferralForPayment(payment.payment.id, paidAt);
    assert.ok(reward);
    assert.equal(reward.pending, true);
    assert.equal(reward.grant.status, VpnAccessGrantStatus.PENDING);
    assert.equal(await vpnAccessGrantService.rewardReferralForPayment(payment.payment.id, paidAt), null);
    assert.equal(
      (await prisma.vpnReferral.findUniqueOrThrow({ where: { invitedUserId: invited.id } })).status,
      VpnReferralStatus.REWARDED,
    );

    await prisma.user.update({
      where: { id: inviter.id },
      data: { clubStatus: ClubMembershipStatus.LEFT },
    });
    const activatedAt = new Date("2026-09-25T08:00:00Z");
    const activated = await vpnAccessGrantService.activatePendingForUser(inviter.id, activatedAt);
    assert.equal(activated.appliedCount, 1);
    assert.equal(
      activated.subscription?.expiresAt?.toISOString(),
      new Date("2026-10-25T08:00:00Z").toISOString(),
    );
    const gift = await vpnAccessGrantService.grantAdminGift({
      userId: inviter.id,
      days: 7,
      grantedByTelegramId: 1n,
      now: new Date("2026-09-26T08:00:00Z"),
    });
    assert.equal(gift.pending, false);
    assert.equal(gift.subscription.expiresAt?.toISOString(), new Date("2026-11-01T08:00:00Z").toISOString());

    await prisma.user.update({
      where: { id: inviter.id },
      data: { clubStatus: ClubMembershipStatus.MEMBER },
    });
    const paused = await vpnAccessGrantService.pauseTimedAccessForUser(
      inviter.id,
      new Date("2026-09-27T08:00:00Z"),
    );
    assert.equal(paused.paused, true);
    await prisma.user.update({
      where: { id: inviter.id },
      data: { clubStatus: ClubMembershipStatus.LEFT },
    });
    const resumed = await vpnAccessGrantService.activatePendingForUser(
      inviter.id,
      new Date("2026-10-04T08:00:00Z"),
    );
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.appliedCount, 0);
    assert.equal(resumed.subscription?.expiresAt?.toISOString(), new Date("2026-11-08T08:00:00Z").toISOString());

    const trialUser = await prisma.user.create({
      data: {
        telegramId: BigInt(`5${Date.now()}`),
        username: `trial_pause_${randomUUID().slice(0, 8)}`,
        clubStatus: ClubMembershipStatus.MEMBER,
      },
    });
    userIds.push(trialUser.id);
    const paidProduct = await prisma.vpnProduct.findUniqueOrThrow({ where: { code: "paid" } });
    const trialSubscription = await prisma.vpnSubscription.create({
      data: { userId: trialUser.id, productId: paidProduct.id, token: randomUUID() },
    });
    await prisma.vpnTrial.create({
      data: {
        vpnSubscriptionId: trialSubscription.id,
        status: VpnTrialStatus.ACTIVE,
        termsVersion: "test-v1",
        termsAcceptedAt: new Date("2026-09-19T08:00:00Z"),
        startedAt: new Date("2026-09-19T08:00:00Z"),
        endsAt: new Date("2026-09-26T08:00:00Z"),
      },
    });
    await vpnAccessGrantService.pauseTimedAccessForUser(
      trialUser.id,
      new Date("2026-09-20T08:00:00Z"),
    );
    await prisma.user.update({
      where: { id: trialUser.id },
      data: { clubStatus: ClubMembershipStatus.LEFT },
    });
    await vpnAccessGrantService.activatePendingForUser(
      trialUser.id,
      new Date("2026-09-25T08:00:00Z"),
    );
    assert.equal(
      (await prisma.vpnTrial.findUniqueOrThrow({
        where: { vpnSubscriptionId: trialSubscription.id },
      })).endsAt?.toISOString(),
      new Date("2026-10-01T08:00:00Z").toISOString(),
    );
  } finally {
    await prisma.vpnAccessGrant.deleteMany({
      where: { vpnSubscription: { userId: { in: userIds } } },
    });
    await prisma.vpnReferral.deleteMany({
      where: { OR: [{ inviterUserId: { in: userIds } }, { invitedUserId: { in: userIds } }] },
    });
    const billingIds = await prisma.vpnBillingSubscription.findMany({
      where: { vpnSubscription: { userId: { in: userIds } } },
      select: { id: true },
    });
    await prisma.vpnPayment.deleteMany({
      where: { billingSubscriptionId: { in: billingIds.map((item) => item.id) } },
    });
    await prisma.vpnBillingSubscription.deleteMany({
      where: { vpnSubscription: { userId: { in: userIds } } },
    });
    await prisma.vpnTrial.deleteMany({
      where: { vpnSubscription: { userId: { in: userIds } } },
    });
    await prisma.vpnSubscription.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
