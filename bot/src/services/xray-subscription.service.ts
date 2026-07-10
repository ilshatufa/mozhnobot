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
    renderMode: "uri" | "json";
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

function shouldRenderJson(userAgent: string): boolean {
  return new RegExp(config.xraySubscription.jsonUserAgentPattern, "i").test(userAgent);
}

function parsedQuery(link: URL): Record<string, string> {
  return Object.fromEntries(
    [...link.searchParams.entries()].map(([key, value]) => [key, value])
  );
}

function splitAlpn(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function routingRules(): Array<Record<string, unknown>> {
  const rules: Array<Record<string, unknown>> = [
    { type: "field", port: "53", outboundTag: "dns-out" },
    { type: "field", ip: config.xraySubscription.jsonPrivateIps, outboundTag: "direct" },
  ];

  if (config.xraySubscription.jsonBlockUdp443) {
    rules.push({ type: "field", network: "udp", port: "443", outboundTag: "block" });
  }

  rules.push(
    { type: "field", domain: config.xraySubscription.jsonDirectDomains, outboundTag: "direct" },
    { type: "field", port: "0-65535", outboundTag: "proxy" }
  );

  return rules;
}

function outboundFromUri(line: string): Record<string, unknown> | null {
  const parsed = new URL(line);
  const query = parsedQuery(parsed);
  const host = parsed.hostname;
  const port = Number(parsed.port);
  if (!host || !port) {
    return null;
  }

  let outbound: Record<string, unknown>;
  if (parsed.protocol === "vless:") {
    const user: Record<string, unknown> = {
      id: decodeURIComponent(parsed.username),
      encryption: query.encryption ?? "none",
    };
    if (query.flow) {
      user.flow = query.flow;
    }

    outbound = {
      tag: "proxy",
      protocol: "vless",
      settings: {
        vnext: [
          {
            address: host,
            port,
            users: [user],
          },
        ],
      },
    };
  } else if (parsed.protocol === "trojan:") {
    outbound = {
      tag: "proxy",
      protocol: "trojan",
      settings: {
        servers: [
          {
            address: host,
            port,
            password: decodeURIComponent(parsed.username),
          },
        ],
      },
    };
  } else {
    return null;
  }

  const streamSettings: Record<string, unknown> = {};
  const network = query.type ?? "tcp";
  streamSettings.network = network;
  if (query.security) {
    streamSettings.security = query.security;
  }

  if (query.security === "tls") {
    const tlsSettings: Record<string, unknown> = {};
    if (query.sni) tlsSettings.serverName = query.sni;
    if (query.fp) tlsSettings.fingerprint = query.fp;
    if (query.alpn) tlsSettings.alpn = splitAlpn(query.alpn);
    if (Object.keys(tlsSettings).length > 0) {
      streamSettings.tlsSettings = tlsSettings;
    }
  } else if (query.security === "reality") {
    const realitySettings: Record<string, unknown> = {};
    if (query.sni) realitySettings.serverName = query.sni;
    if (query.fp) realitySettings.fingerprint = query.fp;
    if (query.pbk) realitySettings.publicKey = query.pbk;
    if (query.sid) realitySettings.shortId = query.sid;
    if (query.spx) realitySettings.spiderX = query.spx;
    if (Object.keys(realitySettings).length > 0) {
      streamSettings.realitySettings = realitySettings;
    }
  }

  if (network === "xhttp") {
    const headers: Record<string, string> = { Pragma: "no-cache" };
    if (query.host) {
      headers.Host = query.host;
    }
    streamSettings.xhttpSettings = {
      path: query.path ?? "/",
      mode: query.mode ?? "auto",
      headers,
    };
  } else if (network === "tcp") {
    streamSettings.tcpSettings = { header: { type: "none" } };
  }

  outbound.streamSettings = streamSettings;
  return outbound;
}

function remarksFromUri(line: string): string {
  try {
    const parsed = new URL(line);
    return parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : "MOZHNO VPN";
  } catch {
    return "MOZHNO VPN";
  }
}

function v2rayJsonConfig(line: string): Record<string, unknown> | null {
  const proxy = outboundFromUri(line);
  if (!proxy) {
    return null;
  }

  return {
    log: { access: "", error: "", loglevel: "warning" },
    inbounds: [
      {
        tag: "socks",
        port: 10808,
        listen: "127.0.0.1",
        protocol: "socks",
        settings: { udp: true },
      },
      {
        tag: "http",
        port: 10809,
        listen: "127.0.0.1",
        protocol: "http",
        settings: {},
      },
    ],
    outbounds: [
      proxy,
      { tag: "direct", protocol: "freedom", settings: {} },
      { tag: "block", protocol: "blackhole", settings: {} },
      { tag: "dns-out", protocol: "dns", settings: {} },
    ],
    dns: {
      queryStrategy: "UseIPv4",
      servers: [
        {
          address: config.xraySubscription.jsonRuDns,
          domains: config.xraySubscription.jsonDirectDomains,
        },
        {
          address: config.xraySubscription.jsonRemoteDns,
          detour: "proxy",
        },
      ],
    },
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: routingRules(),
    },
    remarks: remarksFromUri(line),
  };
}

function renderV2rayJson(links: string[]): Buffer {
  const configs: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const link of links) {
    if (seen.has(link)) continue;
    seen.add(link);

    const item = v2rayJsonConfig(link);
    if (item) {
      configs.push(item);
    }
  }

  return Buffer.from(JSON.stringify(configs), "utf8");
}

function renderUriSubscription(links: string[]): Buffer {
  const text = `${links.join("\n")}\n`;
  return Buffer.from(Buffer.from(text, "utf8").toString("base64"), "utf8");
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

function contentDispositionHeader(): string {
  return [
    `attachment; filename="${config.xraySubscription.fileName}"`,
    `filename*=UTF-8''${encodeURIComponent(config.xraySubscription.fileNameUtf8)}`,
  ].join("; ");
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

    const renderMode = shouldRenderJson(userAgent) ? "json" : "uri";
    const body = renderMode === "json" ? renderV2rayJson(links) : renderUriSubscription(links);
    const usedBytes = keys.reduce<bigint>((sum, key) => sum + (key.trafficUsedBytes ?? 0n), 0n);

    logger.info("Xray subscription rendered", {
      userId: entryPoint.userId,
      telegramId: entryPoint.user.telegramId.toString(),
      remoteAddress,
      userAgent,
      renderMode,
      links: links.length,
      servers: keys.map((key) => key.server?.code ?? "unknown"),
    });

    return {
      body,
      headers: {
        "Content-Type": renderMode === "json" ? "application/json" : "text/plain; charset=utf-8",
        "Profile-Title": profileTitleHeader(),
        "Profile-Update-Interval": String(config.xraySubscription.updateIntervalHours),
        ...(config.xraySubscription.supportUrl ? { "Support-Url": config.xraySubscription.supportUrl } : {}),
        "Subscription-Userinfo": [
          `upload=0`,
          `download=${usedBytes.toString()}`,
          `total=0`,
          `expire=0`,
        ].join("; "),
        "Content-Disposition": contentDispositionHeader(),
        "Cache-Control": "no-store",
      },
      meta: {
        userId: entryPoint.userId,
        telegramId: entryPoint.user.telegramId.toString(),
        servers: keys.map((key) => key.server?.code ?? "unknown"),
        links: links.length,
        renderMode,
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
