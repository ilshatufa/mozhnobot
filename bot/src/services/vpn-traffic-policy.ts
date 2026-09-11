import { VpnProductAccessPolicy } from "@prisma/client";

export const DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES = 10n * 1024n ** 3n;

function isWhitelistClientGroup(clientGroup: string): boolean {
  return /^whitelist(?:$|[-_])/.test(clientGroup.trim().toLowerCase());
}

export function resolveVpnTrafficLimitBytes(
  clientGroup: string,
  configuredLimitBytes: bigint | null,
): bigint | null {
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
): number {
  if (
    accessPolicy === VpnProductAccessPolicy.PAID_BALANCE &&
    isWhitelistClientGroup(clientGroup) &&
    (expiresAt === null || expiresAt <= now)
  ) {
    return 0;
  }
  return configuredResetDays;
}
