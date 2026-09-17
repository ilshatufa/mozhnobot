import { randomBytes } from "node:crypto";
import {
  Prisma,
  VpnBillingSubscriptionStatus,
  VpnPaymentStatus,
  VpnSubscriptionAccessOverride,
  VpnSubscriptionStatus,
  VpnTrialStatus,
  type VpnBillingSubscription,
  type VpnPayment,
  type VpnSubscription,
} from "@prisma/client";
import { prisma } from "../database.js";
import { vpnSubscriptionRepository } from "../repositories/vpn-subscription.repository.js";

export const VPN_STARS_CURRENCY = "XTR";
export const VPN_SUBSCRIPTION_PERIOD_SECONDS = 2_592_000;

const currentBillingStatuses: VpnBillingSubscriptionStatus[] = [
  VpnBillingSubscriptionStatus.CREATED,
  VpnBillingSubscriptionStatus.ACTIVE,
  VpnBillingSubscriptionStatus.CANCELED,
  VpnBillingSubscriptionStatus.FAILED,
];

const billingOverviewInclude = {
  vpnSubscription: {
    include: {
      product: true,
      user: true,
    },
  },
  payments: {
    orderBy: { paidAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.VpnBillingSubscriptionInclude;

export type VpnBillingSubscriptionWithOverview = Prisma.VpnBillingSubscriptionGetPayload<{
  include: typeof billingOverviewInclude;
}>;

export interface PaidVpnBillingOverview {
  subscription: VpnSubscription | null;
  billingSubscription: VpnBillingSubscriptionWithOverview | null;
}

export interface CreateVpnInvoiceInput {
  userId: number;
  amountStars: number;
  termsVersion: string;
  acceptedAt: Date;
  now?: Date;
}

export interface ValidateVpnCheckoutInput {
  telegramId: bigint;
  invoicePayload: string;
  currency: string;
  totalAmount: number;
  configuredAmountStars: number;
  configuredTermsVersion: string;
  salesAllowed: boolean;
}

export interface SuccessfulVpnPaymentInput {
  telegramId: bigint;
  invoicePayload: string;
  telegramPaymentChargeId: string;
  providerPaymentChargeId: string | null;
  currency: string;
  totalAmount: number;
  isRecurring: boolean;
  isFirstRecurring: boolean;
  subscriptionExpirationDate: Date;
  paidAt: Date;
}

export interface SuccessfulVpnPaymentResult {
  payment: VpnPayment;
  subscription: VpnSubscription;
  billingSubscription: VpnBillingSubscription;
  duplicate: boolean;
}

export type CreateVpnInvoiceResult =
  | { billingSubscription: VpnBillingSubscription; accessAlreadyAvailable: false }
  | { billingSubscription: VpnBillingSubscription | null; accessAlreadyAvailable: true };

export interface VpnCheckoutValidation {
  ok: boolean;
  reason?: string;
  billingSubscription?: VpnBillingSubscriptionWithOverview;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTransactionConflictError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function mapTelegramSubscriptionState(state: string): VpnBillingSubscriptionStatus | null {
  switch (state) {
    case "active":
      return VpnBillingSubscriptionStatus.ACTIVE;
    case "canceled":
      return VpnBillingSubscriptionStatus.CANCELED;
    case "failed":
      return VpnBillingSubscriptionStatus.FAILED;
    default:
      return null;
  }
}

export class VpnBillingService {
  async getOverview(userId: number): Promise<PaidVpnBillingOverview> {
    const subscription = await vpnSubscriptionRepository.findByUserAndProduct(userId, "paid");
    if (!subscription) return { subscription: null, billingSubscription: null };

    const billingSubscription = await prisma.vpnBillingSubscription.findFirst({
      where: { vpnSubscriptionId: subscription.id },
      include: billingOverviewInclude,
      orderBy: { createdAt: "desc" },
    });
    return { subscription, billingSubscription };
  }

  async createInvoice(input: CreateVpnInvoiceInput): Promise<CreateVpnInvoiceResult> {
    const now = input.now ?? new Date();
    const { subscription } = await vpnSubscriptionRepository.findOrCreateForProduct(
      input.userId,
      "paid",
      randomBytes(24).toString("base64url"),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const freshSubscription = await tx.vpnSubscription.findUniqueOrThrow({
            where: { id: subscription.id },
          });
          const accessAlreadyAvailable =
            freshSubscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
            (freshSubscription.expiresAt !== null && freshSubscription.expiresAt > now);
          const current = await tx.vpnBillingSubscription.findFirst({
            where: {
              vpnSubscriptionId: subscription.id,
              status: { in: currentBillingStatuses },
            },
            orderBy: { createdAt: "desc" },
          });

          if (accessAlreadyAvailable && current) {
            return { billingSubscription: current, accessAlreadyAvailable: true as const };
          }
          if (accessAlreadyAvailable) {
            return { billingSubscription: null, accessAlreadyAvailable: true as const };
          }

          if (
            current?.status === VpnBillingSubscriptionStatus.CREATED &&
            current.currency === VPN_STARS_CURRENCY &&
            current.amountStars === input.amountStars &&
            current.periodSeconds === VPN_SUBSCRIPTION_PERIOD_SECONDS &&
            current.productCode === "paid" &&
            current.termsVersion === input.termsVersion
          ) {
            const refreshed = await tx.vpnBillingSubscription.update({
              where: { id: current.id },
              data: { termsAcceptedAt: input.acceptedAt },
            });
            return { billingSubscription: refreshed, accessAlreadyAvailable: false as const };
          }

          if (current) {
            await tx.vpnBillingSubscription.update({
              where: { id: current.id },
              data: {
                status: VpnBillingSubscriptionStatus.ENDED,
                stateUpdatedAt: now,
              },
            });
          }

          const billingSubscription = await tx.vpnBillingSubscription.create({
            data: {
              vpnSubscriptionId: subscription.id,
              invoicePayload: randomBytes(32).toString("base64url"),
              currency: VPN_STARS_CURRENCY,
              amountStars: input.amountStars,
              periodSeconds: VPN_SUBSCRIPTION_PERIOD_SECONDS,
              productCode: "paid",
              termsVersion: input.termsVersion,
              termsAcceptedAt: input.acceptedAt,
            },
          });
          return { billingSubscription, accessAlreadyAvailable: false as const };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt === 2 || (!isUniqueConstraintError(error) && !isTransactionConflictError(error))) {
          throw error;
        }
      }
    }
    throw new Error("Failed to create a VPN invoice after transaction retries");
  }

  async validateCheckout(input: ValidateVpnCheckoutInput): Promise<VpnCheckoutValidation> {
    if (!input.salesAllowed) {
      return { ok: false, reason: "Продажи сейчас приостановлены. Откройте /vpn позже." };
    }

    const billingSubscription = await prisma.vpnBillingSubscription.findUnique({
      where: { invoicePayload: input.invoicePayload },
      include: billingOverviewInclude,
    });
    if (!billingSubscription) {
      return { ok: false, reason: "Счёт устарел. Откройте /vpn и создайте новый." };
    }
    if (billingSubscription.vpnSubscription.user.telegramId !== input.telegramId) {
      return { ok: false, reason: "Этот счёт создан для другого пользователя." };
    }
    if (
      billingSubscription.vpnSubscription.user.isBanned ||
      billingSubscription.vpnSubscription.user.vpnBlocked ||
      !billingSubscription.vpnSubscription.product.isActive ||
      billingSubscription.vpnSubscription.status !== VpnSubscriptionStatus.ACTIVE
    ) {
      return { ok: false, reason: "Подписка сейчас недоступна. Напишите в поддержку." };
    }
    if (
      billingSubscription.vpnSubscription.accessOverride ===
        VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
      (billingSubscription.vpnSubscription.expiresAt !== null &&
        billingSubscription.vpnSubscription.expiresAt > new Date())
    ) {
      return { ok: false, reason: "Доступ уже подключён. Откройте /vpn для актуального статуса." };
    }
    if (billingSubscription.status !== VpnBillingSubscriptionStatus.CREATED) {
      return { ok: false, reason: "Этот счёт уже обработан. Откройте /vpn для актуального статуса." };
    }
    if (
      billingSubscription.currency !== VPN_STARS_CURRENCY ||
      billingSubscription.currency !== input.currency ||
      billingSubscription.amountStars !== input.totalAmount ||
      billingSubscription.amountStars !== input.configuredAmountStars ||
      billingSubscription.periodSeconds !== VPN_SUBSCRIPTION_PERIOD_SECONDS ||
      billingSubscription.productCode !== "paid" ||
      billingSubscription.termsVersion !== input.configuredTermsVersion
    ) {
      return { ok: false, reason: "Условия счёта изменились. Откройте /vpn и создайте новый." };
    }
    return { ok: true, billingSubscription };
  }

  async recordSuccessfulPayment(input: SuccessfulVpnPaymentInput): Promise<SuccessfulVpnPaymentResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const duplicate = await tx.vpnPayment.findUnique({
            where: { telegramPaymentChargeId: input.telegramPaymentChargeId },
            include: { billingSubscription: true },
          });
          if (duplicate) {
            if (
              duplicate.billingSubscription.invoicePayload !== input.invoicePayload ||
              duplicate.currency !== input.currency ||
              duplicate.amountStars !== input.totalAmount
            ) {
              throw new Error("Duplicate VPN payment does not match the original payment");
            }
            const subscription = await tx.vpnSubscription.findUniqueOrThrow({
              where: { id: duplicate.billingSubscription.vpnSubscriptionId },
            });
            const owner = await tx.user.findUniqueOrThrow({ where: { id: subscription.userId } });
            if (owner.telegramId !== input.telegramId) {
              throw new Error("Duplicate VPN payment Telegram user does not match invoice owner");
            }
            return {
              payment: duplicate,
              subscription,
              billingSubscription: duplicate.billingSubscription,
              duplicate: true,
            };
          }

          const billingSubscription = await tx.vpnBillingSubscription.findUnique({
            where: { invoicePayload: input.invoicePayload },
            include: {
              vpnSubscription: { include: { user: true, product: true } },
            },
          });
          if (!billingSubscription) throw new Error("Unknown VPN invoice payload");
          if (billingSubscription.vpnSubscription.user.telegramId !== input.telegramId) {
            throw new Error("VPN payment Telegram user does not match invoice owner");
          }
          if (
            billingSubscription.currency !== VPN_STARS_CURRENCY ||
            input.currency !== billingSubscription.currency ||
            input.totalAmount !== billingSubscription.amountStars ||
            billingSubscription.periodSeconds !== VPN_SUBSCRIPTION_PERIOD_SECONDS ||
            billingSubscription.productCode !== "paid" ||
            billingSubscription.vpnSubscription.product.code !== "paid"
          ) {
            throw new Error("VPN payment does not match invoice snapshot");
          }
          if (!input.isRecurring || input.subscriptionExpirationDate <= input.paidAt) {
            throw new Error("VPN payment is missing a valid recurring subscription expiration");
          }

          const payment = await tx.vpnPayment.create({
            data: {
              billingSubscriptionId: billingSubscription.id,
              telegramPaymentChargeId: input.telegramPaymentChargeId,
              providerPaymentChargeId: input.providerPaymentChargeId,
              status: VpnPaymentStatus.PAID,
              currency: input.currency,
              amountStars: input.totalAmount,
              isRecurring: input.isRecurring,
              isFirstRecurring: input.isFirstRecurring,
              subscriptionExpirationDate: input.subscriptionExpirationDate,
              paidAt: input.paidAt,
            },
          });
          await tx.vpnBillingSubscription.updateMany({
            where: {
              vpnSubscriptionId: billingSubscription.vpnSubscriptionId,
              id: { not: billingSubscription.id },
              status: { in: currentBillingStatuses },
            },
            data: {
              status: VpnBillingSubscriptionStatus.ENDED,
              stateUpdatedAt: input.paidAt,
            },
          });
          const previousStateAt = billingSubscription.stateUpdatedAt;
          const effectiveStateAt = previousStateAt && previousStateAt > input.paidAt
            ? previousStateAt
            : input.paidAt;
          const updatedBillingSubscription = await tx.vpnBillingSubscription.update({
            where: { id: billingSubscription.id },
            data: {
              status: VpnBillingSubscriptionStatus.ACTIVE,
              telegramSubscriptionChargeId:
                billingSubscription.telegramSubscriptionChargeId ?? input.telegramPaymentChargeId,
              activatedAt: billingSubscription.activatedAt ?? input.paidAt,
              stateUpdatedAt: effectiveStateAt,
            },
          });
          const existingExpiration = billingSubscription.vpnSubscription.expiresAt;
          const effectiveExpiration = existingExpiration && existingExpiration > input.subscriptionExpirationDate
            ? existingExpiration
            : input.subscriptionExpirationDate;
          const subscription = await tx.vpnSubscription.update({
            where: { id: billingSubscription.vpnSubscriptionId },
            data: {
              status: VpnSubscriptionStatus.ACTIVE,
              expiresAt: effectiveExpiration,
            },
          });
          await tx.vpnTrial.updateMany({
            where: {
              vpnSubscriptionId: billingSubscription.vpnSubscriptionId,
              status: { in: [VpnTrialStatus.PROVISIONING, VpnTrialStatus.ACTIVE] },
            },
            data: {
              status: VpnTrialStatus.CONVERTED,
              convertedAt: input.paidAt,
            },
          });
          return {
            payment,
            subscription,
            billingSubscription: updatedBillingSubscription,
            duplicate: false,
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isTransactionConflictError(error) && attempt < 2) continue;
        if (!isUniqueConstraintError(error)) throw error;
        const payment = await prisma.vpnPayment.findUniqueOrThrow({
          where: { telegramPaymentChargeId: input.telegramPaymentChargeId },
          include: {
            billingSubscription: {
              include: { vpnSubscription: { include: { user: true } } },
            },
          },
        });
        if (
          payment.billingSubscription.invoicePayload !== input.invoicePayload ||
          payment.currency !== input.currency ||
          payment.amountStars !== input.totalAmount ||
          payment.billingSubscription.vpnSubscription.user.telegramId !== input.telegramId
        ) {
          throw new Error("Concurrent duplicate VPN payment does not match the original payment");
        }
        return {
          payment,
          subscription: payment.billingSubscription.vpnSubscription,
          billingSubscription: payment.billingSubscription,
          duplicate: true,
        };
      }
    }
    throw new Error("Failed to record a VPN payment after transaction retries");
  }

  async updateTelegramSubscriptionState(input: {
    telegramId: bigint;
    invoicePayload: string;
    state: string;
    occurredAt: Date;
  }): Promise<VpnBillingSubscription | null> {
    const status = mapTelegramSubscriptionState(input.state);
    if (!status) return null;
    const current = await prisma.vpnBillingSubscription.findUnique({
      where: { invoicePayload: input.invoicePayload },
      include: { vpnSubscription: { include: { user: true } } },
    });
    if (
      !current ||
      current.status === VpnBillingSubscriptionStatus.ENDED ||
      current.vpnSubscription.user.telegramId !== input.telegramId
    ) return null;
    return prisma.vpnBillingSubscription.update({
      where: { id: current.id },
      data: { status, stateUpdatedAt: input.occurredAt },
    });
  }

  async findCancelable(userId: number, now = new Date()): Promise<VpnBillingSubscriptionWithOverview | null> {
    return prisma.vpnBillingSubscription.findFirst({
      where: {
        vpnSubscription: {
          userId,
          expiresAt: { gt: now },
        },
        status: VpnBillingSubscriptionStatus.ACTIVE,
        telegramSubscriptionChargeId: { not: null },
      },
      include: billingOverviewInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  async markCanceled(id: number, occurredAt = new Date()): Promise<VpnBillingSubscription> {
    return prisma.vpnBillingSubscription.update({
      where: { id },
      data: {
        status: VpnBillingSubscriptionStatus.CANCELED,
        stateUpdatedAt: occurredAt,
      },
    });
  }

  async findPendingQuotaResets(vpnSubscriptionId: number): Promise<VpnPayment[]> {
    return prisma.vpnPayment.findMany({
      where: {
        billingSubscription: { vpnSubscriptionId },
        status: VpnPaymentStatus.PAID,
        quotaResetAt: null,
      },
      orderBy: { paidAt: "asc" },
    });
  }

  async markQuotaReset(paymentId: number, resetAt = new Date()): Promise<void> {
    await prisma.vpnPayment.update({
      where: { id: paymentId },
      data: { quotaResetAt: resetAt, quotaResetError: null },
    });
  }

  async markQuotaResetFailed(paymentId: number, error: string): Promise<void> {
    await prisma.vpnPayment.update({
      where: { id: paymentId },
      data: { quotaResetError: error },
    });
  }
}

export const vpnBillingService = new VpnBillingService();
