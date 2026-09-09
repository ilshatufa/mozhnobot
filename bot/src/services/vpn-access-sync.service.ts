import { VpnProductAccessPolicy } from "@prisma/client";
import {
  vpnSubscriptionRepository,
  type VpnSubscriptionForSync,
} from "../repositories/vpn-subscription.repository.js";
import {
  buildVpnAccessSyncPlan,
  type VpnAccessSyncPlan,
} from "./vpn-access-sync-plan.js";

export interface PaidVpnAccessProvider {
  hasAccess(subscription: VpnSubscriptionForSync, now: Date): Promise<boolean>;
}

class DenyUnavailablePaidVpnAccessProvider implements PaidVpnAccessProvider {
  async hasAccess(): Promise<boolean> {
    return false;
  }
}

export interface PlannedVpnSubscriptionSync {
  subscriptionId: number;
  userId: number;
  productCode: string;
  plan: VpnAccessSyncPlan;
}

export class VpnAccessSyncService {
  constructor(
    private readonly paidAccessProvider: PaidVpnAccessProvider = new DenyUnavailablePaidVpnAccessProvider(),
  ) {}

  async buildPlan(filters: {
    subscriptionId?: number;
    userId?: number;
    now?: Date;
  } = {}): Promise<PlannedVpnSubscriptionSync[]> {
    const now = filters.now ?? new Date();
    const subscriptions = await vpnSubscriptionRepository.findManyForSync(filters);
    const result: PlannedVpnSubscriptionSync[] = [];

    for (const subscription of subscriptions) {
      const paidAccess = subscription.product.accessPolicy === VpnProductAccessPolicy.PAID_BALANCE
        ? await this.paidAccessProvider.hasAccess(subscription, now)
        : false;

      result.push({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        productCode: subscription.product.code,
        plan: buildVpnAccessSyncPlan({
          now,
          paidAccess,
          user: subscription.user,
          product: subscription.product,
          subscription,
        }),
      });
    }

    return result;
  }
}

export const vpnAccessSyncService = new VpnAccessSyncService();
