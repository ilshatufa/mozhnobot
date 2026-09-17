import {
  VpnSubscriptionAccessOverride,
  VpnTrialStatus,
} from "@prisma/client";

export type VpnEntitlementKind =
  | "FREE_UNLIMITED"
  | "PAID"
  | "TRIAL"
  | "TRIAL_PROVISIONING"
  | "NONE";

export interface VpnEntitlement {
  kind: VpnEntitlementKind;
  expiresAt: Date | null;
}

export const VPN_TRIAL_DURATION_DAYS = 7;
export const VPN_TRIAL_WHITELIST_LIMIT_BYTES = 1n * 1024n ** 3n;

interface EntitlementSubscription {
  accessOverride: VpnSubscriptionAccessOverride;
  expiresAt: Date | null;
  accessPausedAt?: Date | null;
  trial?: {
    status: VpnTrialStatus;
    endsAt: Date | null;
    createdAt: Date;
  } | null;
}

const PROVISIONING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function resolveVpnEntitlement(
  subscription: EntitlementSubscription,
  now = new Date(),
): VpnEntitlement {
  if (subscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED) {
    return { kind: "FREE_UNLIMITED", expiresAt: null };
  }
  if (subscription.accessPausedAt) return { kind: "NONE", expiresAt: null };
  if (subscription.expiresAt && subscription.expiresAt > now) {
    return { kind: "PAID", expiresAt: subscription.expiresAt };
  }
  if (
    subscription.trial?.status === VpnTrialStatus.ACTIVE &&
    subscription.trial.endsAt &&
    subscription.trial.endsAt > now
  ) {
    return { kind: "TRIAL", expiresAt: subscription.trial.endsAt };
  }
  if (subscription.trial?.status === VpnTrialStatus.PROVISIONING) {
    return {
      kind: "TRIAL_PROVISIONING",
      expiresAt: new Date(subscription.trial.createdAt.getTime() + PROVISIONING_WINDOW_MS),
    };
  }
  return { kind: "NONE", expiresAt: null };
}

export function isVpnEntitlementActive(entitlement: VpnEntitlement): boolean {
  return entitlement.kind !== "NONE";
}
