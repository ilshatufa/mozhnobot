function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join(".");
}

export function findFreeIp(cidr: string, usedIps: Set<string>): string {
  const [baseIp, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  if (!baseIp || !Number.isInteger(prefix) || prefix < 1 || prefix > 30) {
    throw new Error(`Unsupported client CIDR: ${cidr}`);
  }

  const base = ipv4ToInt(baseIp);
  const size = 2 ** (32 - prefix);
  const network = Math.floor(base / size) * size;
  const firstHost = network + 2;
  const lastHost = network + size - 2;

  for (let current = firstHost; current <= lastHost; current += 1) {
    const ip = intToIpv4(current);
    if (!usedIps.has(ip) && !usedIps.has(`${ip}/32`)) {
      return `${ip}/32`;
    }
  }

  throw new Error(`No free IP addresses in ${cidr}`);
}

export function normalizeAllowedIp(value: string): string {
  return value.split(",")[0]?.trim() ?? value;
}

