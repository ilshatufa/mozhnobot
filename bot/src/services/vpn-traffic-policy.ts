import { VpnProductAccessPolicy } from "@prisma/client";
import type { VpnEntitlementKind } from "./vpn-entitlement.js";

export const DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES = 10n * 1024n ** 3n;

function isWhitelistClientGroup(clientGroup: string): boolean {
  return /^whitelist(?:$|[-_])/.test(clientGroup.trim().toLowerCase());
}

export function resolveVpnTrafficLimitBytes(
  clientGroup: string,
  configuredLimitBytes: bigint | null,
  entitlementKind: VpnEntitlementKind = "NONE",
  trialWhitelistLimitBytes = 1n * 1024n ** 3n,
): bigint | null {
  if (
    isWhitelistClientGroup(clientGroup) &&
    (entitlementKind === "TRIAL" || entitlementKind === "TRIAL_PROVISIONING")
  ) {
    return trialWhitelistLimitBytes;
  }
  if (configuredLimitBytes !== null) return configuredLimitBytes;
  if (isWhitelistClientGroup(clientGroup)) {
    return DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES;
  }
  return null;
}

export function resolveVpnTrafficResetDays(
  accessPolicy: VpnProductAccessPolicy,
  clientGroup: string,
  configuredResetDays: number,
  expiresAt: Date | null,
  now = new Date(),
  entitlementKind: VpnEntitlementKind = "NONE",
): number {
  if (
    accessPolicy === VpnProductAccessPolicy.PAID_BALANCE &&
    isWhitelistClientGroup(clientGroup) &&
    entitlementKind !== "PAID"
  ) {
    return 0;
  }
  return configuredResetDays;
}
