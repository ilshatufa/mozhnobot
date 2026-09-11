export const DEFAULT_PAID_WHITELIST_TRAFFIC_LIMIT_BYTES = 10n * 1024n ** 3n;

function isWhitelistClientGroup(clientGroup: string): boolean {
  return /^whitelist(?:$|[-_])/.test(clientGroup.trim().toLowerCase());
}

export function resolveVpnTrafficLimitBytes(
  productCode: string,
  clientGroup: string,
  configuredLimitBytes: bigint | null,
): bigint | null {
  if (configuredLimitBytes !== null) return configuredLimitBytes;
  if (productCode === "paid" && isWhitelistClientGroup(clientGroup)) {
    return DEFAULT_PAID_WHITELIST_TRAFFIC_LIMIT_BYTES;
  }
  return null;
}
