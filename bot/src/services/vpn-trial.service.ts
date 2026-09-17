import { randomBytes } from "node:crypto";
import {
  Prisma,
  VpnSubscriptionAccessOverride,
  VpnSubscriptionInboundStatus,
  VpnTrialStatus,
  type User,
  type VpnTrial,
} from "@prisma/client";
import { prisma } from "../database.js";
import { vpnSubscriptionRepository } from "../repositories/vpn-subscription.repository.js";
import { vpnAccessSyncService } from "./vpn-access-sync.service.js";
import { VPN_TRIAL_DURATION_DAYS } from "./vpn-entitlement.js";

export type StartVpnTrialResult =
  | { status: "ACTIVE"; trial: VpnTrial }
  | { status: "PROVISIONING"; trial: VpnTrial; errors: string[] }
  | { status: "INELIGIBLE"; trial: VpnTrial | null };

export interface VpnTrialOverview {
  trial: VpnTrial | null;
  whitelistUsedBytes: bigint | null;
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002");
}

export class VpnTrialService {
  async findTrial(userId: number): Promise<VpnTrial | null> {
    return prisma.vpnTrial.findFirst({
      where: { vpnSubscription: { userId, product: { code: "paid" } } },
    });
  }

  async getOverview(userId: number, now = new Date()): Promise<VpnTrialOverview> {
    const subscription = await prisma.vpnSubscription.findFirst({
      where: { userId, product: { code: "paid" } },
      include: { trial: true },
    });
    if (!subscription?.trial) return { trial: null, whitelistUsedBytes: null };

    let trial = subscription.trial;
    if (
      trial.status === VpnTrialStatus.ACTIVE &&
      trial.endsAt &&
      trial.endsAt <= now
    ) {
      trial = await prisma.vpnTrial.update({
        where: { id: trial.id },
        data: { status: VpnTrialStatus.EXPIRED },
      });
    }

    if (
      trial.status !== VpnTrialStatus.ACTIVE ||
      subscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
      (subscription.expiresAt !== null && subscription.expiresAt > now)
    ) {
      return { trial, whitelistUsedBytes: null };
    }

    const key = await prisma.vpnKey.findFirst({
      where: {
        subscriptionId: subscription.id,
        clientGroup: { startsWith: "whitelist" },
        isActive: true,
      },
      orderBy: { id: "asc" },
    });
    return { trial, whitelistUsedBytes: key?.trafficUsedBytes ?? 0n };
  }

  async startTrial(input: {
    user: User;
    termsVersion: string;
    acceptedAt: Date;
    now?: Date;
  }): Promise<StartVpnTrialResult> {
    const now = input.now ?? new Date();
    const { subscription } = await vpnSubscriptionRepository.findOrCreateForProduct(
      input.user.id,
      "paid",
      randomBytes(24).toString("base64url"),
    );

    let trial: VpnTrial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const fresh = await tx.vpnSubscription.findUniqueOrThrow({
            where: { id: subscription.id },
            include: {
              trial: true,
              billingSubscriptions: { select: { payments: { select: { id: true }, take: 1 } } },
            },
          });
          const hasPayment = fresh.billingSubscriptions.some((item) => item.payments.length > 0);
          if (
            fresh.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
            fresh.expiresAt !== null ||
            hasPayment
          ) {
            return { ineligible: true as const, trial: fresh.trial };
          }
          if (fresh.trial) return { ineligible: false as const, trial: fresh.trial };
          return {
            ineligible: false as const,
            trial: await tx.vpnTrial.create({
              data: {
                vpnSubscriptionId: fresh.id,
                termsVersion: input.termsVersion,
                termsAcceptedAt: input.acceptedAt,
              },
            }),
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (result.ineligible) return { status: "INELIGIBLE", trial: result.trial };
        trial = result.trial;
        break;
      } catch (error) {
        if (attempt === 2 || !isRetryableTransactionError(error)) throw error;
      }
    }

    trial = trial!;
    if (trial.status === VpnTrialStatus.ACTIVE) return { status: "ACTIVE", trial };
    if (trial.status !== VpnTrialStatus.PROVISIONING) {
      return { status: "INELIGIBLE", trial };
    }

    const [sync] = await vpnAccessSyncService.sync({ subscriptionId: subscription.id, now });
    if (!sync?.provisioning?.success) {
      return {
        status: "PROVISIONING",
        trial,
        errors: sync?.provisioning?.errors ?? ["VPN trial provisioning did not return a result"],
      };
    }

    const [provisioned] = await vpnSubscriptionRepository.findManyForSync({
      subscriptionId: subscription.id,
    });
    const activeInboundIds = new Set(
      provisioned?.inboundStates
        .filter((state) => state.status === VpnSubscriptionInboundStatus.ACTIVE)
        .map((state) => state.inboundId) ?? [],
    );
    const activeProductInbounds = provisioned?.product.inbounds.filter(
      (item) => item.inbound.isActive,
    ) ?? [];
    const allFourProfilesReady = activeProductInbounds.length === 4 &&
      activeProductInbounds.every((item) => activeInboundIds.has(item.inboundId));
    if (!allFourProfilesReady) {
      return {
        status: "PROVISIONING",
        trial,
        errors: ["VPN trial requires exactly four active product profiles"],
      };
    }

    const durationMs = VPN_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const claimed = await prisma.vpnTrial.updateMany({
      where: { id: trial.id, status: VpnTrialStatus.PROVISIONING },
      data: {
        status: VpnTrialStatus.ACTIVE,
        startedAt: now,
        endsAt: new Date(now.getTime() + durationMs),
      },
    });
    const activated = await prisma.vpnTrial.findUniqueOrThrow({ where: { id: trial.id } });
    if (claimed.count !== 1) {
      return activated.status === VpnTrialStatus.ACTIVE
        ? { status: "ACTIVE", trial: activated }
        : { status: "INELIGIBLE", trial: activated };
    }
    const [activatedSync] = await vpnAccessSyncService.sync({
      subscriptionId: subscription.id,
      now,
    });
    if (!activatedSync?.provisioning?.success) {
      return {
        status: "PROVISIONING",
        trial: activated,
        errors: activatedSync?.provisioning?.errors ?? ["VPN trial expiry synchronization failed"],
      };
    }
    return { status: "ACTIVE", trial: activated };
  }
}

export const vpnTrialService = new VpnTrialService();
