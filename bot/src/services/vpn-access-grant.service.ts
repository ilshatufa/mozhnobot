import { randomBytes } from "node:crypto";
import {
  ClubMembershipStatus,
  Prisma,
  VpnAccessGrantStatus,
  VpnAccessGrantType,
  VpnReferralStatus,
  VpnSubscriptionAccessOverride,
  VpnSubscriptionStatus,
  VpnTrialStatus,
  type VpnAccessGrant,
  type VpnSubscription,
} from "@prisma/client";
import { prisma } from "../database.js";

export const VPN_REFERRAL_REWARD_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

type TransactionClient = Prisma.TransactionClient;

export type RegisterVpnStartResult =
  | { status: "STARTED" | "ALREADY_STARTED" }
  | { status: "REFERRAL_ACCEPTED"; inviterUserId: number }
  | { status: "REFERRAL_INVALID" | "REFERRAL_INELIGIBLE" };

export interface ApplyVpnGrantResult {
  grant: VpnAccessGrant;
  subscription: VpnSubscription;
  pending: boolean;
  duplicate: boolean;
}

export interface ReferralRewardResult extends ApplyVpnGrantResult {
  inviterTelegramId: bigint;
  referralId: number;
}

function referralCodeFromPayload(payload: string | undefined): string | null {
  if (!payload) return null;
  const match = payload.trim().match(/^ref_([A-Za-z0-9_-]{8,24})$/);
  return match?.[1] ?? null;
}

function laterDate(...values: Array<Date | null | undefined>): Date {
  return values.reduce<Date>((latest, value) => (
    value && value > latest ? value : latest
  ), new Date(0));
}

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034");
}

async function serializableTransaction<T>(
  operation: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryable(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Serializable VPN access transaction retry exhausted");
}

export class VpnAccessGrantService {
  async registerStart(
    userId: number,
    payload: string | undefined,
    now = new Date(),
  ): Promise<RegisterVpnStartResult> {
    return serializableTransaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.paidVpnStartedAt) return { status: "ALREADY_STARTED" };

      await tx.user.update({
        where: { id: userId },
        data: { paidVpnStartedAt: now },
      });

      const code = referralCodeFromPayload(payload);
      if (!code) return { status: payload ? "REFERRAL_INVALID" : "STARTED" };
      const inviter = await tx.user.findUnique({ where: { paidVpnReferralCode: code } });
      if (!inviter || inviter.id === userId) return { status: "REFERRAL_INVALID" };

      const paidHistory = await tx.vpnSubscription.findFirst({
        where: {
          userId,
          product: { code: "paid" },
          OR: [
            { trial: { isNot: null } },
            { billingSubscriptions: { some: { payments: { some: {} } } } },
          ],
        },
        select: { id: true },
      });
      if (paidHistory) return { status: "REFERRAL_INELIGIBLE" };

      await tx.vpnReferral.create({
        data: { inviterUserId: inviter.id, invitedUserId: userId },
      });
      return { status: "REFERRAL_ACCEPTED", inviterUserId: inviter.id };
    });
  }

  async ensureReferralCode(userId: number): Promise<string> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (current.paidVpnReferralCode) return current.paidVpnReferralCode;
      const code = randomBytes(8).toString("base64url");
      try {
        const claimed = await prisma.user.updateMany({
          where: { id: userId, paidVpnReferralCode: null },
          data: { paidVpnReferralCode: code },
        });
        if (claimed.count === 1) return code;
      } catch (error) {
        if (!isRetryable(error) || attempt === 3) throw error;
      }
    }
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).paidVpnReferralCode!;
  }

  async getReferralStats(userId: number): Promise<{ invited: number; rewarded: number }> {
    const [invited, rewarded] = await Promise.all([
      prisma.vpnReferral.count({ where: { inviterUserId: userId } }),
      prisma.vpnReferral.count({
        where: { inviterUserId: userId, status: VpnReferralStatus.REWARDED },
      }),
    ]);
    return { invited, rewarded };
  }

  async grantAdminGift(input: {
    userId: number;
    days: number;
    grantedByTelegramId: bigint;
    now?: Date;
  }): Promise<ApplyVpnGrantResult> {
    const now = input.now ?? new Date();
    return serializableTransaction((tx) => this.applyGrantTx(tx, {
      userId: input.userId,
      type: VpnAccessGrantType.ADMIN_GIFT,
      durationSeconds: input.days * SECONDS_PER_DAY,
      idempotencyKey: `admin:${input.grantedByTelegramId}:${randomBytes(12).toString("base64url")}`,
      grantedByTelegramId: input.grantedByTelegramId,
      now,
    }));
  }

  async pauseTimedAccessForUser(userId: number, now = new Date()): Promise<{
    paused: boolean;
    subscriptionId: number | null;
  }> {
    const subscription = await prisma.vpnSubscription.findFirst({
      where: { userId, product: { code: "paid" } },
    });
    if (!subscription) return { paused: false, subscriptionId: null };
    if (subscription.accessPausedAt) return { paused: false, subscriptionId: subscription.id };
    const updated = await prisma.vpnSubscription.updateMany({
      where: { id: subscription.id, accessPausedAt: null },
      data: { accessPausedAt: now },
    });
    return { paused: updated.count === 1, subscriptionId: subscription.id };
  }

  async activatePendingForUser(userId: number, now = new Date()): Promise<{
    appliedCount: number;
    resumed: boolean;
    subscription: VpnSubscription | null;
  }> {
    return serializableTransaction(async (tx) => {
      const subscription = await tx.vpnSubscription.findFirst({
        where: { userId, product: { code: "paid" } },
        include: { user: true, trial: true },
      });
      if (!subscription) return { appliedCount: 0, resumed: false, subscription: null };
      if (
        subscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
        subscription.user.clubStatus === ClubMembershipStatus.MEMBER
      ) {
        return { appliedCount: 0, resumed: false, subscription };
      }

      let effectiveSubscription: VpnSubscription = subscription;
      let effectiveTrial = subscription.trial;
      let resumed = false;
      if (subscription.accessPausedAt) {
        const pausedMs = Math.max(0, now.getTime() - subscription.accessPausedAt.getTime());
        const shiftedExpiration = subscription.expiresAt && subscription.expiresAt > subscription.accessPausedAt
          ? new Date(subscription.expiresAt.getTime() + pausedMs)
          : subscription.expiresAt;
        effectiveSubscription = await tx.vpnSubscription.update({
          where: { id: subscription.id },
          data: { accessPausedAt: null, expiresAt: shiftedExpiration },
        });
        if (
          subscription.trial?.status === VpnTrialStatus.ACTIVE &&
          subscription.trial.endsAt &&
          subscription.trial.endsAt > subscription.accessPausedAt
        ) {
          effectiveTrial = await tx.vpnTrial.update({
            where: { id: subscription.trial.id },
            data: {
              endsAt: new Date(subscription.trial.endsAt.getTime() + pausedMs),
              endingSoonNotifiedAt: null,
              expiredNotifiedAt: null,
            },
          });
        }
        resumed = true;
      }

      const pending = await tx.vpnAccessGrant.findMany({
        where: { vpnSubscriptionId: subscription.id, status: VpnAccessGrantStatus.PENDING },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (pending.length === 0) {
        return { appliedCount: 0, resumed, subscription: effectiveSubscription };
      }

      const trialEnd = effectiveTrial?.status === VpnTrialStatus.ACTIVE
        ? effectiveTrial.endsAt
        : null;
      let cursor = laterDate(now, effectiveSubscription.expiresAt, trialEnd);
      const needsReset = !effectiveSubscription.expiresAt || effectiveSubscription.expiresAt <= now;
      for (const [index, grant] of pending.entries()) {
        const startsAt = cursor;
        cursor = new Date(startsAt.getTime() + grant.durationSeconds * 1000);
        await tx.vpnAccessGrant.update({
          where: { id: grant.id },
          data: {
            status: VpnAccessGrantStatus.APPLIED,
            startsAt,
            endsAt: cursor,
            quotaResetRequired: needsReset && index === 0,
          },
        });
      }
      const updated = await tx.vpnSubscription.update({
        where: { id: subscription.id },
        data: { status: VpnSubscriptionStatus.ACTIVE, expiresAt: cursor },
      });
      await tx.vpnTrial.updateMany({
        where: {
          vpnSubscriptionId: subscription.id,
          status: { in: [VpnTrialStatus.PROVISIONING, VpnTrialStatus.ACTIVE] },
        },
        data: { status: VpnTrialStatus.CONVERTED, convertedAt: now },
      });
      return { appliedCount: pending.length, resumed, subscription: updated };
    });
  }

  async rewardReferralForPayment(paymentId: number, now = new Date()): Promise<ReferralRewardResult | null> {
    return serializableTransaction(async (tx) => {
      const payment = await tx.vpnPayment.findUniqueOrThrow({
        where: { id: paymentId },
        include: {
          billingSubscription: { include: { vpnSubscription: true } },
        },
      });
      const invitedUserId = payment.billingSubscription.vpnSubscription.userId;
      const referral = await tx.vpnReferral.findUnique({
        where: { invitedUserId },
        include: { inviter: true },
      });
      if (!referral || referral.status !== VpnReferralStatus.PENDING) return null;

      const firstPayment = await tx.vpnPayment.findFirst({
        where: {
          billingSubscription: { vpnSubscription: { userId: invitedUserId } },
        },
        select: { id: true },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      });
      if (!firstPayment || firstPayment.id !== payment.id) return null;

      const grantResult = await this.applyGrantTx(tx, {
        userId: referral.inviterUserId,
        type: VpnAccessGrantType.REFERRAL_REWARD,
        durationSeconds: VPN_REFERRAL_REWARD_DAYS * SECONDS_PER_DAY,
        idempotencyKey: `referral:${referral.id}`,
        sourceReferralId: referral.id,
        now,
      });
      await tx.vpnReferral.update({
        where: { id: referral.id },
        data: {
          status: VpnReferralStatus.REWARDED,
          qualifyingPaymentId: payment.id,
          qualifiedAt: payment.paidAt,
          rewardedAt: now,
        },
      });
      return {
        ...grantResult,
        inviterTelegramId: referral.inviter.telegramId,
        referralId: referral.id,
      };
    });
  }

  async findPendingQuotaResets(subscriptionId: number): Promise<VpnAccessGrant[]> {
    return prisma.vpnAccessGrant.findMany({
      where: {
        vpnSubscriptionId: subscriptionId,
        status: VpnAccessGrantStatus.APPLIED,
        quotaResetRequired: true,
        quotaResetAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async markQuotaReset(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.vpnAccessGrant.updateMany({
      where: { id: { in: ids } },
      data: { quotaResetAt: new Date(), quotaResetError: null },
    });
  }

  async markQuotaResetFailed(ids: number[], error: string): Promise<void> {
    if (ids.length === 0) return;
    await prisma.vpnAccessGrant.updateMany({
      where: { id: { in: ids } },
      data: { quotaResetError: error.slice(0, 4_000) },
    });
  }

  private async applyGrantTx(tx: TransactionClient, input: {
    userId: number;
    type: VpnAccessGrantType;
    durationSeconds: number;
    idempotencyKey: string;
    grantedByTelegramId?: bigint;
    sourceReferralId?: number;
    now: Date;
  }): Promise<ApplyVpnGrantResult> {
    const existing = await tx.vpnAccessGrant.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { vpnSubscription: true },
    });
    if (existing) {
      return {
        grant: existing,
        subscription: existing.vpnSubscription,
        pending: existing.status === VpnAccessGrantStatus.PENDING,
        duplicate: true,
      };
    }

    const product = await tx.vpnProduct.findFirst({
      where: { code: "paid", isActive: true },
      select: { id: true },
    });
    if (!product) throw new Error("Active VPN product paid is not configured");
    const subscription = await tx.vpnSubscription.upsert({
      where: { userId_productId: { userId: input.userId, productId: product.id } },
      create: {
        userId: input.userId,
        productId: product.id,
        token: randomBytes(24).toString("base64url"),
      },
      update: { status: VpnSubscriptionStatus.ACTIVE },
      include: { user: true, trial: true },
    });
    const pending =
      subscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
      subscription.user.clubStatus === ClubMembershipStatus.MEMBER;
    const trialEnd = subscription.trial?.status === VpnTrialStatus.ACTIVE
      ? subscription.trial.endsAt
      : null;
    const startsAt = pending ? null : laterDate(input.now, subscription.expiresAt, trialEnd);
    const endsAt = startsAt
      ? new Date(startsAt.getTime() + input.durationSeconds * 1000)
      : null;
    const needsReset = !pending && (!subscription.expiresAt || subscription.expiresAt <= input.now);
    const grant = await tx.vpnAccessGrant.create({
      data: {
        vpnSubscriptionId: subscription.id,
        type: input.type,
        status: pending ? VpnAccessGrantStatus.PENDING : VpnAccessGrantStatus.APPLIED,
        durationSeconds: input.durationSeconds,
        startsAt,
        endsAt,
        idempotencyKey: input.idempotencyKey,
        grantedByTelegramId: input.grantedByTelegramId,
        sourceReferralId: input.sourceReferralId,
        quotaResetRequired: needsReset,
      },
    });
    if (pending || !endsAt) {
      return { grant, subscription, pending: true, duplicate: false };
    }

    const updated = await tx.vpnSubscription.update({
      where: { id: subscription.id },
      data: { status: VpnSubscriptionStatus.ACTIVE, expiresAt: endsAt },
    });
    await tx.vpnTrial.updateMany({
      where: {
        vpnSubscriptionId: subscription.id,
        status: { in: [VpnTrialStatus.PROVISIONING, VpnTrialStatus.ACTIVE] },
      },
      data: { status: VpnTrialStatus.CONVERTED, convertedAt: input.now },
    });
    return { grant, subscription: updated, pending: false, duplicate: false };
  }
}

export const vpnAccessGrantService = new VpnAccessGrantService();
