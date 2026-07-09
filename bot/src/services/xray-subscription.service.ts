import { VpnProvider, type VpnKey, type VpnServer, type User } from "@prisma/client";
import { config, type XuiServerConfig } from "../config.js";
import { prisma } from "../database.js";
import { logger } from "../logger.js";

const SUBSCRIPTION_PROTOCOLS = [
  "vless://",
  "vmess://",
  "trojan://",
  "ss://",
  "hysteria://",
  "hysteria2://",
];

type XuiKeyWithServer = VpnKey & {
  server: VpnServer | null;
};

type EntryPointKey = VpnKey & {
  user: User;
};

export interface RenderedSubscription {
  body: Buffer;
  headers: Record<string, string>;
  meta: {
    userId: number;
    telegramId: string;
    servers: string[];
    links: number;
  };
}

function decodeSubscriptionBody(body: string): string {
  const trimmed = body.trim();
  if (SUBSCRIPTION_PROTOCOLS.some((protocol) => trimmed.includes(protocol))) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
  return SUBSCRIPTION_PROTOCOLS.some((protocol) => decoded.includes(protocol)) ? decoded : trimmed;
}

function isSubscriptionLink(value: string): boolean {
  return SUBSCRIPTION_PROTOCOLS.some((protocol) => value.startsWith(protocol));
}

function rawSubBaseUrl(server: XuiServerConfig): string {
  return (server.rawSubBaseUrl ?? server.subBaseUrl).replace(/\/+$/, "");
}

function subscriptionUrl(server: XuiServerConfig, subId: string): string {
  return `${rawSubBaseUrl(server)}/sub/${subId}`;
}

function linkHost(line: string): string | null {
  try {
    const parsed = new URL(line);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function expectedHost(server: XuiServerConfig): string {
  return new URL(rawSubBaseUrl(server)).hostname.toLowerCase();
}

function displayName(server: XuiServerConfig): string {
  const source = `${server.code} ${server.name}`.toLowerCase();
  if (source.includes("ru")) return "MOZHNO RU";
  if (source.includes("de")) return "MOZHNO DE";
  if (source.includes("lv")) return "MOZHNO LV";
  return server.name;
}

function rewriteDisplayName(line: string, name: string): string {
  try {
    const parsed = new URL(line);
    parsed.hash = encodeURIComponent(name);
    return parsed.toString();
  } catch {
    return line;
  }
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function profileTitleHeader(): string {
  return `base64:${Buffer.from(config.xraySubscription.title, "utf8").toString("base64")}`;
}

function publicSubscriptionUrl(subId: string): string {
  const baseUrl = config.vpnServers.xui.multiSubBaseUrl;
  if (!baseUrl) {
    return "";
  }
  return `${baseUrl.replace(/\/+$/, "")}/sub/${subId}`;
}

export class XraySubscriptionService {
  async render(subId: string, userAgent: string, remoteAddress: string): Promise<RenderedSubscription | null> {
    const entryPoint = await this.findEntryPointKey(subId);
    if (!entryPoint || !this.isUserAllowed(entryPoint.user)) {
      return null;
    }

    const keys = await this.findUserXuiKeys(entryPoint.userId);
    const links = await this.collectLinks(keys);
    if (links.length === 0) {
      return null;
    }

    const text = `${links.join("\n")}\n`;
    const body = Buffer.from(Buffer.from(text, "utf8").toString("base64"), "utf8");
    const expiresAt = keys.reduce<Date>((min, key) => key.expiresAt < min ? key.expiresAt : min, entryPoint.expiresAt);
    const usedBytes = keys.reduce<bigint>((sum, key) => sum + (key.trafficUsedBytes ?? 0n), 0n);
    const limitBytes = entryPoint.user.vpnTrafficLimitBytes;

    logger.info("Xray subscription rendered", {
      userId: entryPoint.userId,
      telegramId: entryPoint.user.telegramId.toString(),
      remoteAddress,
      userAgent,
      links: links.length,
      servers: keys.map((key) => key.server?.code ?? "unknown"),
    });

    return {
      body,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Profile-Title": profileTitleHeader(),
        "Profile-Update-Interval": String(config.xraySubscription.updateIntervalHours),
        "Subscription-Userinfo": [
          `upload=0`,
          `download=${usedBytes.toString()}`,
          `total=${limitBytes?.toString() ?? "0"}`,
          `expire=${unixSeconds(expiresAt)}`,
        ].join("; "),
        "Cache-Control": "no-store",
      },
      meta: {
        userId: entryPoint.userId,
        telegramId: entryPoint.user.telegramId.toString(),
        servers: keys.map((key) => key.server?.code ?? "unknown"),
        links: links.length,
      },
    };
  }

  getPublicSubscriptionUrl(subId: string): string {
    return publicSubscriptionUrl(subId);
  }

  private async findEntryPointKey(subId: string): Promise<EntryPointKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        subId,
        provider: VpnProvider.XUI,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private isUserAllowed(user: User): boolean {
    return !user.vpnBlocked && !user.isBanned;
  }

  private async findUserXuiKeys(userId: number): Promise<XuiKeyWithServer[]> {
    return prisma.vpnKey.findMany({
      where: {
        userId,
        provider: VpnProvider.XUI,
        isActive: true,
        expiresAt: { gt: new Date() },
        subId: { not: null },
      },
      include: {
        server: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  private async collectLinks(keys: XuiKeyWithServer[]): Promise<string[]> {
    const result: string[] = [];
    const seen = new Set<string>();
    const keysByServerCode = new Map(keys.map((key) => [key.server?.code, key]));

    for (const serverConfig of config.vpnServers.xui.servers) {
      const key = keysByServerCode.get(serverConfig.code);
      if (!key?.subId || !key.server) continue;

      const links = await this.fetchServerLinks(serverConfig, key.subId);
      for (const link of links) {
        const rewritten = rewriteDisplayName(link, displayName(serverConfig));
        if (seen.has(rewritten)) continue;
        seen.add(rewritten);
        result.push(rewritten);
      }
    }

    return result;
  }

  private async fetchServerLinks(server: XuiServerConfig, subId: string): Promise<string[]> {
    const url = subscriptionUrl(server, subId);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "xray-subscription-service/1.0",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI subscription ${server.code} failed: ${res.status} ${body}`);
    }

    const decoded = decodeSubscriptionBody(await res.text());
    const host = expectedHost(server);
    return decoded
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => isSubscriptionLink(line))
      .filter((line) => linkHost(line) === host);
  }
}

export const xraySubscriptionService = new XraySubscriptionService();
