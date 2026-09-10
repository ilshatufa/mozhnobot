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
  settings?: unknown;
}

interface XuiInboundClient {
  id: string;
  email: string;
  subId: string | null;
}

interface XuiClientTraffic {
  up?: unknown;
  down?: unknown;
}

interface XuiBulkSetEnableResult {
  skipped?: Array<{ email?: unknown; reason?: unknown }>;
}

interface XuiClientRecordResponse {
  client?: {
    id?: unknown;
    uuid?: unknown;
    email?: unknown;
    subId?: unknown;
  };
  inboundIds?: unknown;
}

export interface XuiManagedClient {
  clientId: string | null;
  email: string;
  subId: string | null;
  inboundIds: number[];
}

interface XuiSession {
  cookie: string;
  csrfToken: string | null;
}

export function xuiInboundIdsForNewClient(server: XuiServerConfig): number[] {
  return [...new Set([server.inboundId, ...server.additionalInboundIds])];
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
    enable: boolean,
    trafficResetDays = 0,
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
      reset: trafficResetDays,
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

  private parseInboundSettings(settingsRaw: unknown, server: XuiServerConfig): { clients?: unknown } | null {
    if (!settingsRaw) {
      return null;
    }

    if (typeof settingsRaw === "object") {
      return settingsRaw as { clients?: unknown };
    }

    if (typeof settingsRaw !== "string") {
      throw new Error(`3X-UI ${server.code} inbound settings has unsupported type: ${typeof settingsRaw}`);
    }

    let parsed: unknown = settingsRaw;
    for (let attempt = 0; attempt < 2 && typeof parsed === "string"; attempt += 1) {
      const trimmed = parsed.trim();
      if (!trimmed) {
        return null;
      }

      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error(`3X-UI ${server.code} inbound settings JSON parse failed`);
      }
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error(`3X-UI ${server.code} inbound settings JSON has unsupported shape`);
    }

    return parsed as { clients?: unknown };
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

    const parsed = this.parseInboundSettings(data.obj?.settings, server);

    const clientsUnknown = parsed?.clients;
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
    trafficLimitBytes: bigint | null,
    options: {
      email?: string;
      inboundIds?: number[];
      trafficResetDays?: number;
    } = {},
  ): Promise<{ clientId: string; email: string; subId: string }> {
    const clientId = randomUUID();
    const email = options.email ?? this.buildClientEmail(telegramId, username);
    const subId = this.generateSubId();
    const inboundIds = options.inboundIds === undefined
      ? xuiInboundIdsForNewClient(server)
      : [...new Set(options.inboundIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (inboundIds.length === 0) {
      throw new Error(`3X-UI ${server.code} addClient requires at least one inbound ID`);
    }
    const clientSettings = this.buildClientSettings(
      clientId,
      email,
      subId,
      server,
      expiryTime,
      trafficLimitBytes,
      true,
      options.trafficResetDays ?? 0,
    );

    const res = this.isClientsApi(server)
      ? await this.request(server, "/panel/api/clients/add", {
          method: "POST",
          body: JSON.stringify({
            client: clientSettings,
            inboundIds,
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
      if (this.isClientsApi(server)) {
        const existing = await this.getClient(server, email);
        const missingInboundIds = inboundIds.filter((id) => !existing.inboundIds.includes(id));
        await this.attachClientToInbounds(server, email, missingInboundIds);
        await this.setClientEnabled(server, email, true);
        if (!existing.clientId || !existing.subId) {
          throw new Error(`3X-UI ${server.code} existing client ${email} has no UUID or subscription ID`);
        }
        await this.updateClientSubscription(
          server,
          existing.clientId,
          email,
          email,
          expiryTime,
          existing.subId,
          trafficLimitBytes,
          options.trafficResetDays ?? 0,
        );
        logger.warn(`3X-UI ${server.code} addClient conflict resolved by clients API lookup (${email})`);
        return {
          clientId: existing.clientId,
          email,
          subId: existing.subId,
        };
      }

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
          trafficLimitBytes,
          options.trafficResetDays ?? 0,
        );
        logger.warn(`3X-UI ${server.code} addClient conflict resolved by existing client ${existing.id} (${existing.email})`);
        return { clientId: existing.id, email, subId: resolvedSubId };
      }

      throw new Error(`3X-UI ${server.code} addClient returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    if (this.isClientsApi(server)) {
      const persisted = await this.getClient(server, email);
      if (!persisted.clientId || !persisted.subId) {
        throw new Error(`3X-UI ${server.code} created client ${email} has no UUID or subscription ID`);
      }
      return {
        clientId: persisted.clientId,
        email,
        subId: persisted.subId,
      };
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
    trafficLimitBytes: bigint | null,
    trafficResetDays = 0,
  ): Promise<void> {
    const clientSettings = this.buildClientSettings(
      xuiClientId,
      email,
      subId,
      server,
      expiryTime,
      trafficLimitBytes,
      true,
      trafficResetDays,
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

  async getClientInboundIds(server: XuiServerConfig, email: string): Promise<number[]> {
    return (await this.getClient(server, email)).inboundIds;
  }

  async getClient(server: XuiServerConfig, email: string): Promise<XuiManagedClient> {
    if (!this.isClientsApi(server)) {
      throw new Error(`3X-UI ${server.code} does not support clients attachment API`);
    }

    const res = await this.request(server, `/panel/api/clients/get/${encodeURIComponent(email)}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} getClient failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse<XuiClientRecordResponse>;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} getClient returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    const inboundIds = Array.isArray(data.obj?.inboundIds)
      ? [...new Set(
          data.obj.inboundIds.filter(
            (value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0,
          ),
        )]
      : [];
    const clientId = typeof data.obj?.client?.uuid === "string"
      ? data.obj.client.uuid
      : typeof data.obj?.client?.id === "string"
        ? data.obj.client.id
        : null;

    return {
      clientId,
      email: typeof data.obj?.client?.email === "string" ? data.obj.client.email : email,
      subId: typeof data.obj?.client?.subId === "string" ? data.obj.client.subId : null,
      inboundIds,
    };
  }

  async getClientLinks(server: XuiServerConfig, email: string): Promise<string[]> {
    if (!this.isClientsApi(server)) {
      throw new Error(`3X-UI ${server.code} does not support clients links API`);
    }

    const res = await this.request(server, `/panel/api/clients/links/${encodeURIComponent(email)}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} getClientLinks failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse<unknown>;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} getClientLinks returned success=false: ${data.msg ?? "unknown reason"}`);
    }
    if (!Array.isArray(data.obj)) {
      throw new Error(`3X-UI ${server.code} getClientLinks returned an unsupported response`);
    }

    return data.obj.filter(
      (value): value is string => typeof value === "string" && this.isSubscriptionLink(value),
    );
  }

  async attachClientToInbounds(server: XuiServerConfig, email: string, inboundIds: number[]): Promise<void> {
    await this.changeClientInboundAttachments(server, email, inboundIds, "attach");
  }

  async detachClientFromInbounds(server: XuiServerConfig, email: string, inboundIds: number[]): Promise<void> {
    await this.changeClientInboundAttachments(server, email, inboundIds, "detach");
  }

  async setClientEnabled(server: XuiServerConfig, email: string, enable: boolean): Promise<void> {
    if (!this.isClientsApi(server)) {
      throw new Error(`3X-UI ${server.code} does not support clients bulk enable API`);
    }

    const operation = enable ? "bulkEnable" : "bulkDisable";
    const res = await this.request(server, `/panel/api/clients/${operation}`, {
      method: "POST",
      body: JSON.stringify({ emails: [email] }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} ${operation} failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse<XuiBulkSetEnableResult>;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} ${operation} returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    const skipped = data.obj?.skipped?.find((item) => item.email === email);
    if (skipped) {
      throw new Error(
        `3X-UI ${server.code} ${operation} skipped ${email}: ${typeof skipped.reason === "string" ? skipped.reason : "unknown reason"}`,
      );
    }
  }

  private async changeClientInboundAttachments(
    server: XuiServerConfig,
    email: string,
    inboundIds: number[],
    operation: "attach" | "detach",
  ): Promise<void> {
    if (!this.isClientsApi(server)) {
      throw new Error(`3X-UI ${server.code} does not support clients attachment API`);
    }

    const normalizedIds = [...new Set(inboundIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (normalizedIds.length === 0) return;

    const res = await this.request(
      server,
      `/panel/api/clients/${encodeURIComponent(email)}/${operation}`,
      {
        method: "POST",
        body: JSON.stringify({ inboundIds: normalizedIds }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI ${server.code} ${operation} failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      throw new Error(`3X-UI ${server.code} ${operation} returned success=false: ${data.msg ?? "unknown reason"}`);
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

  async getClientTraffic(server: XuiServerConfig, email: string): Promise<bigint> {
    const paths = this.isClientsApi(server)
      ? [
          `/panel/api/clients/traffic/${encodeURIComponent(email)}`,
          `/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`,
        ]
      : [`/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`];

    let lastError = "unknown error";
    for (const path of paths) {
      const res = await this.request(server, path);
      if (!res.ok) {
        lastError = `${res.status} ${await res.text()}`;
        continue;
      }

      const data = await res.json() as XuiApiResponse<XuiClientTraffic | null>;
      if (!data.success) {
        lastError = data.msg ?? "success=false";
        continue;
      }

      const up = this.nonNegativeBigInt(data.obj?.up);
      const down = this.nonNegativeBigInt(data.obj?.down);
      return up + down;
    }

    throw new Error(`3X-UI ${server.code} traffic lookup failed: ${lastError}`);
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

  private nonNegativeBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value >= 0n ? value : 0n;
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.max(0, Math.trunc(value)));
    }
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
    return 0n;
  }

  getSubscriptionUrl(server: XuiServerConfig, subId: string): string {
    return `${server.subBaseUrl.replace(/\/+$/, "")}/sub/${subId}`;
  }
}

export const xuiClient = new XuiClient();
