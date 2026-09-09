import { VpnProductAccessPolicy } from "@prisma/client";
import {
  vpnSubscriptionRepository,
  type VpnSubscriptionForSync,
} from "../repositories/vpn-subscription.repository.js";
import {
  buildVpnAccessSyncPlan,
  type VpnAccessSyncPlan,
} from "./vpn-access-sync-plan.js";
import {
  vpnAccessProvisioner,
  type VpnAccessProvisioningResult,
} from "./vpn-access-provisioner.js";

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
  provisioning?: VpnAccessProvisioningResult;
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

  async sync(filters: {
    subscriptionId?: number;
    userId?: number;
    now?: Date;
  } = {}): Promise<PlannedVpnSubscriptionSync[]> {
    const plans = await this.buildPlan(filters);

    for (const item of plans) {
      const [subscription] = await vpnSubscriptionRepository.findManyForSync({
        subscriptionId: item.subscriptionId,
      });
      if (!subscription) {
        item.provisioning = {
          success: false,
          errors: [`VPN subscription ${item.subscriptionId} disappeared before provisioning`],
        };
        continue;
      }
      try {
        item.provisioning = await vpnAccessProvisioner.apply(subscription, item.plan);
      } catch (err) {
        item.provisioning = {
          success: false,
          errors: [err instanceof Error ? err.message : String(err)],
        };
      }
    }

    return plans;
  }
}

export const vpnAccessSyncService = new VpnAccessSyncService();
