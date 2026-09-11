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
