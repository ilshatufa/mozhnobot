import { randomBytes, randomUUID } from "node:crypto";
import { type XuiServerConfig } from "../config.js";
import { logger } from "../logger.js";

interface XuiClientSettings {
  id: string;
  email: string;
  subId: string;
  flow: string;
  enable: boolean;
  expiryTime: number;
  totalGB: number;
  security?: string;
  reset?: number;
  limitIp?: number;
  tgId?: number;
  group?: string;
  comment?: string;
}

interface XuiApiResponse<T = unknown> {
  success: boolean;
  msg?: string;
  obj?: T;
}

interface XuiInboundObject {
  settings?: string;
}

interface XuiInboundClient {
  id: string;
  email: string;
  subId: string | null;
}

interface XuiSession {
  cookie: string;
  csrfToken: string | null;
}

export class XuiClient {
  private sessions = new Map<string, XuiSession>();
  private static readonly SUBSCRIPTION_PROTOCOLS = [
    "vless://",
    "vmess://",
    "trojan://",
    "ss://",
    "hysteria://",
    "hysteria2://",
  ];

  private formatTrafficLimitBytes(trafficLimitBytes: bigint | null): number {
    return trafficLimitBytes === null ? 0 : Number(trafficLimitBytes);
  }

  buildClientEmail(telegramId: bigint, username?: string | null): string {
    const normalized = (username ?? "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    return normalized ? `tg_${telegramId}_${normalized}` : `tg_${telegramId}`;
  }

  generateSubId(): string {
    return randomBytes(16).toString("hex");
  }

  private baseUrl(server: XuiServerConfig): string {
    return server.apiBaseUrl.replace(/\/+$/, "");
  }

  private isClientsApi(server: XuiServerConfig): boolean {
    return server.clientApiMode === "clients";
  }

  private buildClientSettings(
    clientId: string,
    email: string,
    subId: string,
    server: XuiServerConfig,
    expiryTime: number,
    trafficLimitBytes: bigint | null,
    enable: boolean
  ): XuiClientSettings {
    return {
      id: clientId,
      email,
      subId,
      flow: server.clientFlow ?? "",
      enable,
      expiryTime,
      totalGB: this.formatTrafficLimitBytes(trafficLimitBytes),
      security: "auto",
      reset: 0,
      limitIp: 0,
      tgId: 0,
      group: "",
      comment: "",
    };
  }

  private async request(server: XuiServerConfig, path: string, init?: RequestInit): Promise<Response> {
    const baseUrl = this.baseUrl(server);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headersToRecord(init?.headers),
    };

    if (server.apiToken) {
      headers.Authorization = `Bearer ${server.apiToken}`;
    } else {
      const session = await this.ensureAuthenticated(server);
      headers.Cookie = session.cookie;
      if (session.csrfToken) {
        headers["X-CSRF-Token"] = session.csrfToken;
      }
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if ((res.status === 401 || res.status === 403) && !server.apiToken) {
      this.sessions.delete(server.code);
      const session = await this.ensureAuthenticated(server);
      return fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          ...headers,
          Cookie: session.cookie,
          ...(session.csrfToken ? { "X-CSRF-Token": session.csrfToken } : {}),
        },
      });
    }

    return res;
  }

  private async ensureAuthenticated(server: XuiServerConfig): Promise<XuiSession> {
    const existing = this.sessions.get(server.code);
    if (existing) return existing;
    if (!server.username || !server.password) {
      throw new Error(`3X-UI ${server.code}: username/password are not configured`);
    }

    const baseUrl = this.baseUrl(server);
    const page = await fetch(`${baseUrl}/`);
    const pageText = await page.text();
    const csrfToken = this.extractCsrfToken(pageText);
    const pageCookie = this.extractSessionCookie(page.headers.get("set-cookie"));

    const loginHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (csrfToken) loginHeaders["X-CSRF-Token"] = csrfToken;
    if (pageCookie) loginHeaders.Cookie = pageCookie;

    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({
        username: server.username,
        password: server.password,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} login failed: ${res.status} ${body}`);
    }

    const cookie = this.extractSessionCookie(res.headers.get("set-cookie")) ?? pageCookie;
    if (!cookie) {
      throw new Error(`3X-UI ${server.code} login: no session cookie returned`);
    }

    const session = { cookie, csrfToken };
    this.sessions.set(server.code, session);
    logger.info(`3X-UI ${server.code} authenticated`);
    return session;
  }

  private extractCsrfToken(html: string): string | null {
    return html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] ?? null;
  }

  private extractSessionCookie(setCookie: string | null): string | null {
    if (!setCookie) return null;
    return setCookie.split(";")[0] || null;
  }

  private headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        typeof value === "string" ? value : value.join(", "),
      ])
    );
  }

  private async listInboundClients(server: XuiServerConfig): Promise<XuiInboundClient[]> {
    const res = await this.request(server, `/panel/api/inbounds/get/${server.inboundId}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} getInbound failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse<XuiInboundObject>;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} getInbound returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    const settingsRaw = data.obj?.settings;
    if (!settingsRaw) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(settingsRaw);
    } catch {
      throw new Error(`3X-UI ${server.code} inbound settings JSON parse failed`);
    }

    const clientsUnknown = (parsed as { clients?: unknown }).clients;
    if (!Array.isArray(clientsUnknown)) {
      return [];
    }

    return clientsUnknown
      .map((client): XuiInboundClient | null => {
        if (!client || typeof client !== "object") return null;
        const id = (client as { id?: unknown }).id;
        const email = (client as { email?: unknown }).email;
        const subId = (client as { subId?: unknown }).subId;
        if (typeof id !== "string" || id.length === 0) return null;
        if (typeof email !== "string" || email.length === 0) return null;

        return {
          id,
          email,
          subId: typeof subId === "string" && subId.length > 0 ? subId : null,
        };
      })
      .filter((client): client is XuiInboundClient => client !== null);
  }

  async addClient(
    server: XuiServerConfig,
    telegramId: bigint,
    username: string | null,
    expiryTime: number,
    trafficLimitBytes: bigint | null
  ): Promise<{ clientId: string; email: string; subId: string }> {
    const clientId = randomUUID();
    const email = this.buildClientEmail(telegramId, username);
    const subId = this.generateSubId();
    const clientSettings = this.buildClientSettings(
      clientId,
      email,
      subId,
      server,
      expiryTime,
      trafficLimitBytes,
      true
    );

    const res = this.isClientsApi(server)
      ? await this.request(server, "/panel/api/clients/add", {
          method: "POST",
          body: JSON.stringify({
            client: clientSettings,
            inboundIds: [server.inboundId],
          }),
        })
      : await this.request(server, "/panel/api/inbounds/addClient", {
          method: "POST",
          body: JSON.stringify({
            id: server.inboundId,
            settings: JSON.stringify({ clients: [clientSettings] }),
          }),
        });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} addClient failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      const existingClients = await this.listInboundClients(server);
      const byEmail = existingClients.find((client) => client.email === email);
      const prefix = `tg_${telegramId}`;
      const byTelegramId = existingClients.find(
        (client) => client.email === prefix || client.email.startsWith(`${prefix}_`)
      );
      const existing = byEmail ?? byTelegramId;

      if (existing) {
        const resolvedSubId = existing.subId ?? this.generateSubId();
        await this.updateClientSubscription(
          server,
          existing.id,
          existing.email,
          email,
          expiryTime,
          resolvedSubId,
          trafficLimitBytes
        );
        logger.warn(`3X-UI ${server.code} addClient conflict resolved by existing client ${existing.id} (${existing.email})`);
        return { clientId: existing.id, email, subId: resolvedSubId };
      }

      throw new Error(`3X-UI ${server.code} addClient returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    return { clientId, email, subId };
  }

  async updateClientSubscription(
    server: XuiServerConfig,
    xuiClientId: string,
    currentEmail: string,
    email: string,
    expiryTime: number,
    subId: string,
    trafficLimitBytes: bigint | null
  ): Promise<void> {
    const clientSettings = this.buildClientSettings(
      xuiClientId,
      email,
      subId,
      server,
      expiryTime,
      trafficLimitBytes,
      true
    );

    const res = this.isClientsApi(server)
      ? await this.request(server, `/panel/api/clients/update/${encodeURIComponent(currentEmail)}`, {
          method: "POST",
          body: JSON.stringify(clientSettings),
        })
      : await this.request(server, `/panel/api/inbounds/updateClient/${xuiClientId}`, {
          method: "POST",
          body: JSON.stringify({
            id: server.inboundId,
            settings: JSON.stringify({ clients: [clientSettings] }),
          }),
        });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} updateClientSubscription failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} updateClientSubscription returned success=false: ${data.msg ?? "unknown reason"}`);
    }
  }

  async disableClient(server: XuiServerConfig, xuiClientId: string, email: string): Promise<void> {
    const res = this.isClientsApi(server)
      ? await this.request(server, `/panel/api/clients/update/${encodeURIComponent(email)}`, {
          method: "POST",
          body: JSON.stringify({
            id: xuiClientId,
            email,
            flow: server.clientFlow ?? "",
            enable: false,
          }),
        })
      : await this.request(server, `/panel/api/inbounds/updateClient/${xuiClientId}`, {
          method: "POST",
          body: JSON.stringify({
            id: server.inboundId,
            settings: JSON.stringify({
              clients: [{ id: xuiClientId, email, flow: server.clientFlow ?? "", enable: false }],
            }),
          }),
        });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} disableClient failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} disableClient returned success=false: ${data.msg ?? "unknown reason"}`);
    }
  }

  async updateExternalLinks(server: XuiServerConfig, email: string, links: string[]): Promise<void> {
    if (!this.isClientsApi(server)) {
      throw new Error(`3X-UI ${server.code} does not support clients externalLinks API`);
    }

    const externalLinks = [...new Set(links)]
      .filter((link) => this.isSubscriptionLink(link))
      .map((value) => ({ kind: "link", value, remark: "" }));

    const res = await this.request(server, `/panel/api/clients/${encodeURIComponent(email)}/externalLinks`, {
      method: "POST",
      body: JSON.stringify({ externalLinks }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} updateExternalLinks failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} updateExternalLinks returned success=false: ${data.msg ?? "unknown reason"}`);
    }
  }

  async fetchSubscriptionLinks(subscriptionUrl: string): Promise<string[]> {
    const res = await fetch(subscriptionUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI subscription fetch failed: ${res.status} ${body}`);
    }

    const body = await res.text();
    const decoded = this.decodeSubscriptionBody(body);
    return decoded
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => this.isSubscriptionLink(line));
  }

  private decodeSubscriptionBody(body: string): string {
    const trimmed = body.trim();
    if (this.containsSubscriptionLink(trimmed)) {
      return trimmed;
    }

    const normalized = trimmed.replace(/\s+/g, "");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
    return this.containsSubscriptionLink(decoded) ? decoded : trimmed;
  }

  private containsSubscriptionLink(value: string): boolean {
    return XuiClient.SUBSCRIPTION_PROTOCOLS.some((protocol) => value.includes(protocol));
  }

  private isSubscriptionLink(value: string): boolean {
    return XuiClient.SUBSCRIPTION_PROTOCOLS.some((protocol) => value.startsWith(protocol));
  }

  getSubscriptionUrl(server: XuiServerConfig, subId: string): string {
    return `${server.subBaseUrl.replace(/\/+$/, "")}/sub/${subId}`;
  }
}

export const xuiClient = new XuiClient();
