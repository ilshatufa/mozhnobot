import {
  Prisma,
  VpnProvider,
  VpnSubscriptionInboundStatus,
  VpnSubscriptionStatus,
  type VpnKey,
  type VpnServer,
  type User,
} from "@prisma/client";
import { config, type XuiServerConfig } from "../config.js";
import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { vpnKeyRepository } from "../repositories/vpn-key.repository.js";
import { xuiClient } from "./xui-client.js";
import { renderVpnInboundProfile } from "./vpn-public-profile.js";

type XuiKeyWithServer = VpnKey & {
  server: VpnServer | null;
};

const renderableSubscriptionInclude = {
  user: true,
  product: {
    include: {
      inbounds: {
        include: { inbound: true },
        orderBy: { position: "asc" },
      },
    },
  },
  keys: {
    where: {
      provider: VpnProvider.XUI,
      isActive: true,
      subId: { not: null },
    },
    include: { server: true },
    orderBy: { createdAt: "asc" },
  },
  inboundStates: true,
} satisfies Prisma.VpnSubscriptionInclude;

type RenderableSubscription = Prisma.VpnSubscriptionGetPayload<{
  include: typeof renderableSubscriptionInclude;
}>;

export interface RenderedSubscription {
  body: Buffer;
  headers: Record<string, string>;
  meta: {
    userId: number;
    telegramId: string;
    servers: string[];
    links: number;
    renderMode: "uri" | "json" | "html";
  };
}

export interface RenderedSubscriptionAsset {
  body: Buffer;
  headers: Record<string, string>;
}

export function hasCompleteRequiredInbounds(
  subscription: {
    product: {
      inbounds: Array<{
        inboundId: number;
        isRequired: boolean;
        inbound: { isActive: boolean };
      }>;
    };
    inboundStates: Array<{
      inboundId: number;
      status: VpnSubscriptionInboundStatus;
    }>;
  },
): boolean {
  const activeInboundIds = new Set(
    subscription.inboundStates
      .filter((state) => state.status === VpnSubscriptionInboundStatus.ACTIVE)
      .map((state) => state.inboundId),
  );
  return subscription.product.inbounds
    .filter((item) => item.isRequired && item.inbound.isActive)
    .every((item) => activeInboundIds.has(item.inboundId));
}

function rawSubBaseUrl(server: XuiServerConfig): string {
  return (server.rawSubBaseUrl ?? server.subBaseUrl).replace(/\/+$/, "");
}

function subscriptionUrl(server: XuiServerConfig, subId: string): string {
  return `${rawSubBaseUrl(server)}/sub/${subId}`;
}

export function rewriteNativeHtml(body: Buffer, subId: string, links?: string[]): Buffer {
  let html = body.toString("utf8");
  html = html.replace("<head>", '<head><link rel="icon" href="data:," />');

  const marker = "window.__SUB_PAGE_DATA__=";
  const dataStart = html.indexOf(marker);
  const dataEnd = dataStart >= 0 ? html.indexOf(";</script>", dataStart + marker.length) : -1;
  if (dataStart < 0 || dataEnd < 0) {
    return Buffer.from(html, "utf8");
  }

  try {
    const pageData = JSON.parse(html.slice(dataStart + marker.length, dataEnd)) as {
      links?: unknown;
      subUrl?: unknown;
    };
    const publicUrl = publicSubscriptionUrl(subId);
    if (publicUrl) {
      pageData.subUrl = publicUrl;
    }
    if (links) {
      pageData.links = links;
    }

    const serialized = JSON.stringify(pageData).replace(/</g, "\\u003c");
    html = `${html.slice(0, dataStart + marker.length)}${serialized}${html.slice(dataEnd)}`;
  } catch (err) {
    logger.warn("Unable to personalize native 3X-UI subscription page", err);
  }

  return Buffer.from(html, "utf8");
}

function shouldRenderJson(userAgent: string): boolean {
  return new RegExp(config.xraySubscription.jsonUserAgentPattern, "i").test(userAgent);
}

function shouldRenderHtml(userAgent: string, acceptHeader: string): boolean {
  return /mozilla/i.test(userAgent) && /(?:^|,)\s*text\/html(?:\s*;|\s*,|$)/i.test(acceptHeader);
}

function parsedQuery(link: URL): Record<string, string> {
  return Object.fromEntries(
    [...link.searchParams.entries()].map(([key, value]) => [key, value])
  );
}

function splitAlpn(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
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

export function outboundFromUri(line: string): Record<string, unknown> | null {
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
    const xhttpSettings: Record<string, unknown> = {
      path: query.path ?? "/",
      mode: query.mode ?? "auto",
      headers,
    };
    const extra = parseJsonObject(query.extra);
    if (extra) {
      xhttpSettings.extra = extra;
    }
    streamSettings.xhttpSettings = xhttpSettings;
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
  async render(
    token: string,
    userAgent: string,
    remoteAddress: string,
    acceptHeader = ""
  ): Promise<RenderedSubscription | null> {
    const subscription = await this.findSubscription(token);
    if (
      !subscription ||
      !this.isUserAllowed(subscription.user) ||
      !hasCompleteRequiredInbounds(subscription)
    ) {
      return null;
    }

    const now = new Date();
    const keys = subscription.keys.filter(
      (key) => key.expiresAt === null || key.expiresAt > now,
    );
    const renderMode = shouldRenderJson(userAgent)
      ? "json"
      : shouldRenderHtml(userAgent, acceptHeader)
        ? "html"
        : "uri";

    if (renderMode === "html") {
      const aggregator = this.subscriptionAggregator();
      const entryPointKey = keys.find((key) => key.server?.code === aggregator.code);
      if (!entryPointKey?.subId) return null;
      const [links] = await Promise.all([
        this.collectLinks(subscription, keys),
        this.syncTraffic(keys),
      ]);
      if (links.length === 0) return null;
      const body = await this.fetchNativeHtml(entryPointKey.subId, token, userAgent, acceptHeader, links);

      logger.info("Xray subscription rendered", {
        userId: subscription.userId,
        telegramId: subscription.user.telegramId.toString(),
        remoteAddress,
        userAgent,
        renderMode,
        links: links.length,
        servers: keys.map((key) => key.server?.code ?? "unknown"),
      });

      return {
        body,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
        meta: {
          userId: subscription.userId,
          telegramId: subscription.user.telegramId.toString(),
          servers: keys.map((key) => key.server?.code ?? "unknown"),
          links: links.length,
          renderMode,
        },
      };
    }

    const [links, usedBytes] = await Promise.all([
      this.collectLinks(subscription, keys),
      this.syncTraffic(keys),
    ]);
    if (links.length === 0) {
      return null;
    }

    const body = renderMode === "json" ? renderV2rayJson(links) : renderUriSubscription(links);

    logger.info("Xray subscription rendered", {
      userId: subscription.userId,
      telegramId: subscription.user.telegramId.toString(),
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
        userId: subscription.userId,
        telegramId: subscription.user.telegramId.toString(),
        servers: keys.map((key) => key.server?.code ?? "unknown"),
        links: links.length,
        renderMode,
      },
    };
  }

  getPublicSubscriptionUrl(subId: string): string {
    return publicSubscriptionUrl(subId);
  }

  async renderAsset(assetName: string): Promise<RenderedSubscriptionAsset> {
    const aggregator = this.subscriptionAggregator();
    const publicUrl = new URL(aggregator.subBaseUrl);
    const assetUrl = new URL(`/sub/assets/${encodeURIComponent(assetName)}`, rawSubBaseUrl(aggregator));
    const res = await fetch(assetUrl, {
      headers: {
        Host: publicUrl.host,
        "User-Agent": "xray-subscription-service/1.0",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI subscription asset ${assetName} failed: ${res.status} ${body}`);
    }

    return {
      body: Buffer.from(await res.arrayBuffer()),
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    };
  }

  async syncAllTraffic(): Promise<void> {
    const keys = await prisma.vpnKey.findMany({
      where: {
        provider: VpnProvider.XUI,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        serverId: { not: null },
        providerClientId: { not: null },
      },
      include: { server: true },
      orderBy: { id: "asc" },
    });

    await this.syncTraffic(keys);
    logger.info("Periodic Xray traffic synchronization complete", { keys: keys.length });
  }

  private async findSubscription(token: string): Promise<RenderableSubscription | null> {
    return prisma.vpnSubscription.findFirst({
      where: {
        token,
        status: VpnSubscriptionStatus.ACTIVE,
        product: { isActive: true },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: renderableSubscriptionInclude,
    });
  }

  private isUserAllowed(user: User): boolean {
    return !user.vpnBlocked && !user.isBanned;
  }

  private async collectLinks(
    subscription: RenderableSubscription,
    keys: XuiKeyWithServer[],
  ): Promise<string[]> {
    const activeInboundIds = new Set(
      subscription.inboundStates
        .filter((state) => state.status === VpnSubscriptionInboundStatus.ACTIVE)
        .map((state) => state.inboundId),
    );
    const desired = subscription.product.inbounds.filter(
      (item) => item.inbound.isActive && activeInboundIds.has(item.inboundId),
    );
    const keysByServerId = new Map(
      keys
        .filter((key): key is XuiKeyWithServer & { serverId: number } => key.serverId !== null)
        .map((key) => [key.serverId, key]),
    );
    const sourceByInboundId = new Map<number, string>();

    for (const serverId of new Set(desired.map((item) => item.inbound.serverId))) {
      const serverInbounds = desired.filter((item) => item.inbound.serverId === serverId);
      const key = keysByServerId.get(serverId);
      if (!key?.server || !key.providerClientId) {
        throw new Error(`VPN subscription ${subscription.id} has no active client for server ${serverId}`);
      }
      const serverConfig = config.vpnServers.xui.servers.find(
        (candidate) => candidate.code === key.server?.code,
      );
      if (!serverConfig) {
        throw new Error(`3X-UI server ${key.server.code} is not configured`);
      }

      const links = await xuiClient.getClientLinks(serverConfig, key.providerClientId);
      if (links.length !== serverInbounds.length) {
        throw new Error(
          `3X-UI ${serverConfig.code} returned ${links.length} links for ${serverInbounds.length} product inbounds`,
        );
      }
      serverInbounds.forEach((item, index) => sourceByInboundId.set(item.inboundId, links[index]));
    }

    return desired.map((item) => {
      const source = sourceByInboundId.get(item.inboundId);
      if (!source) throw new Error(`VPN inbound ${item.inbound.code} has no provider link`);
      return renderVpnInboundProfile(source, item.inbound.name, item.inbound.publicProfile);
    });
  }

  private async syncTraffic(keys: XuiKeyWithServer[]): Promise<bigint> {
    const totals: bigint[] = [];
    for (const key of keys) {
      const serverConfig = config.vpnServers.xui.servers.find((server) => server.code === key.server?.code);
      if (!serverConfig || !key.providerClientId) {
        totals.push(key.trafficUsedBytes ?? 0n);
        continue;
      }

      try {
        const usedBytes = await xuiClient.getClientTraffic(serverConfig, key.providerClientId);
        await vpnKeyRepository.updateTraffic(key.id, usedBytes);
        totals.push(usedBytes);
      } catch (err) {
        logger.warn(`Unable to sync Xray traffic for key ${key.id} on ${serverConfig.code}`, err);
        totals.push(key.trafficUsedBytes ?? 0n);
      }
    }

    return totals.reduce((sum, value) => sum + value, 0n);
  }

  private async fetchNativeHtml(
    upstreamSubId: string,
    publicToken: string,
    userAgent: string,
    acceptHeader: string,
    links: string[],
  ): Promise<Buffer> {
    const aggregator = this.subscriptionAggregator();
    const publicUrl = new URL(aggregator.subBaseUrl);
    const res = await fetch(subscriptionUrl(aggregator, upstreamSubId), {
      headers: {
        Accept: acceptHeader || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Host: publicUrl.host,
        "Sec-Fetch-Mode": "navigate",
        "User-Agent": userAgent,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI HTML subscription ${aggregator.code} failed: ${res.status} ${body}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("text/html")) {
      throw new Error(`3X-UI HTML subscription ${aggregator.code} returned ${contentType || "unknown content type"}`);
    }

    return rewriteNativeHtml(Buffer.from(await res.arrayBuffer()), publicToken, links);
  }

  private subscriptionAggregator(): XuiServerConfig {
    const aggregator = config.vpnServers.xui.multiServerCode
      ? config.vpnServers.xui.servers.find(
          (server) => server.code === config.vpnServers.xui.multiServerCode
        )
      : config.vpnServers.xui.servers[0];
    if (!aggregator) {
      throw new Error("Xray subscription aggregator is not configured");
    }
    return aggregator;
  }
}

export const xraySubscriptionService = new XraySubscriptionService();
