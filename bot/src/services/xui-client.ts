import { randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";

interface XuiClientSettings {
  id: string;
  email: string;
  subId: string;
  flow: string;
  enable: boolean;
  expiryTime: number;
  totalGB: number;
}

interface XuiApiResponse<T = unknown> {
  success: boolean;
  msg?: string;
  obj?: T;
}

interface XuiInboundObject {
  settings?: string | { clients?: unknown };
}

interface XuiInboundClient {
  id: string;
  email: string;
  subId: string | null;
}

interface XuiClientDetail {
  client?: Record<string, unknown>;
}

interface XuiClientUpdate {
  email: string;
  subId?: string;
  flow?: string;
  enable: boolean;
  expiryTime?: number;
  totalGB?: number;
}

export class XuiClient {
  private cookie: string | null = null;
  private csrfToken: string | null = null;
  private static readonly CLIENT_FLOW = "xtls-rprx-vision";

  buildClientEmail(telegramId: bigint, username?: string | null): string {
    const normalized = (username ?? "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    return normalized ? `tg_${telegramId}_${normalized}` : `tg_${telegramId}`;
  }

  private get baseUrl(): string {
    return config.xui.baseUrl;
  }

  private buildRequestHeaders(init?: RequestInit): Headers {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("Cookie", this.cookie!);
    if (this.csrfToken) {
      headers.set("X-CSRF-Token", this.csrfToken);
    }
    return headers;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    await this.ensureAuthenticated();

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.buildRequestHeaders(init),
    });

    if (res.status === 401 || res.status === 403) {
      this.cookie = null;
      this.csrfToken = null;
      await this.ensureAuthenticated();
      return fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.buildRequestHeaders(init),
      });
    }

    return res;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.cookie) return;

    const page = await fetch(`${this.baseUrl}/`);
    const pageText = await page.text();
    const csrfToken = pageText.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] ?? null;
    const pageCookie = page.headers.get("set-cookie")?.split(";")[0] ?? null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (pageCookie) headers.Cookie = pageCookie;

    const res = await fetch(`${this.baseUrl}/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        username: config.xui.username,
        password: config.xui.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`3X-UI login failed: ${res.status}`);
    }

    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? pageCookie;
    if (!cookie) {
      throw new Error("3X-UI login: no session cookie returned");
    }

    this.cookie = cookie;
    this.csrfToken = csrfToken;
    logger.info("3X-UI authenticated");
  }

  generateSubId(): string {
    return randomBytes(16).toString("hex");
  }

  private async listInboundClients(): Promise<XuiInboundClient[]> {
    const res = await this.request(`/panel/api/inbounds/get/${config.xui.inboundId}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI getInbound failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse<XuiInboundObject>;
    if (!data.success) {
      throw new Error(`3X-UI getInbound returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    const settingsRaw = data.obj?.settings;
    if (!settingsRaw) {
      return [];
    }

    let parsed: unknown = settingsRaw;
    if (typeof settingsRaw === "string") {
      try {
        parsed = JSON.parse(settingsRaw);
      } catch {
        throw new Error("3X-UI inbound settings JSON parse failed");
      }
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

  private async updateClientViaModernApi(
    xuiClientId: string,
    fallbackEmail: string,
    update: XuiClientUpdate
  ): Promise<Response | null> {
    const inboundClients = await this.listInboundClients();
    const currentEmail = inboundClients.find((client) => client.id === xuiClientId)?.email ?? fallbackEmail;
    const detailRes = await this.request(`/panel/api/clients/get/${encodeURIComponent(currentEmail)}`);

    // 3X-UI versions before the global clients API use the legacy inbound routes.
    if (detailRes.status === 404) return null;
    if (!detailRes.ok) {
      const body = await detailRes.text();
      throw new Error(`3X-UI getClient failed: ${detailRes.status} ${body}`);
    }

    const detail = await detailRes.json() as XuiApiResponse<XuiClientDetail>;
    const current = detail.obj?.client;
    if (!detail.success || !current) {
      throw new Error(`3X-UI getClient returned success=false: ${detail.msg ?? "unknown reason"}`);
    }

    const currentUuid = typeof current.uuid === "string" ? current.uuid : xuiClientId;
    const client = {
      id: currentUuid,
      email: update.email,
      subId: update.subId ?? current.subId ?? "",
      flow: update.flow ?? current.flow ?? XuiClient.CLIENT_FLOW,
      security: current.security ?? "",
      limitIp: current.limitIp ?? 0,
      totalGB: update.totalGB ?? current.totalGB ?? 0,
      expiryTime: update.expiryTime ?? current.expiryTime ?? 0,
      enable: update.enable,
      tgId: current.tgId ?? 0,
      group: current.group ?? "",
      comment: current.comment ?? "",
      reset: current.reset ?? 0,
      resetDay: current.resetDay ?? 0,
      resetMax: current.resetMax ?? 0,
      trafficReset: current.trafficReset ?? "never",
      trafficResetDay: current.trafficResetDay ?? 1,
    };

    return this.request(
      `/panel/api/clients/update/${encodeURIComponent(currentEmail)}?inboundIds=${config.xui.inboundId}`,
      { method: "POST", body: JSON.stringify(client) }
    );
  }

  async addClient(
    telegramId: bigint,
    username: string | null
  ): Promise<{ clientId: string; email: string; subId: string }> {
    const clientId = randomUUID();
    const email = this.buildClientEmail(telegramId, username);
    const subId = this.generateSubId();

    const clientSettings: XuiClientSettings = {
      id: clientId,
      email,
      subId,
      flow: XuiClient.CLIENT_FLOW,
      enable: true,
      expiryTime: 0,
      totalGB: 0,
    };

    let res = await this.request(
      "/panel/api/clients/add",
      {
        method: "POST",
        body: JSON.stringify({
          client: { ...clientSettings, tgId: Number(telegramId) },
          inboundIds: [config.xui.inboundId],
        }),
      }
    );

    if (res.status === 404) {
      res = await this.request(
        "/panel/api/inbounds/addClient",
        {
          method: "POST",
          body: JSON.stringify({
            id: config.xui.inboundId,
            settings: JSON.stringify({ clients: [clientSettings] }),
          }),
        }
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI addClient failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      const existingClients = await this.listInboundClients();
      const byEmail = existingClients.find((client) => client.email === email);
      const prefix = `tg_${telegramId}`;
      const byTelegramId = existingClients.find(
        (client) => client.email === prefix || client.email.startsWith(`${prefix}_`)
      );
      const existing = byEmail ?? byTelegramId;

      if (existing) {
        const resolvedSubId = existing.subId ?? this.generateSubId();
        await this.updateClientSubscription(existing.id, email, resolvedSubId);
        logger.warn(`3X-UI addClient conflict resolved by existing client ${existing.id} (${existing.email})`);
        return { clientId: existing.id, email, subId: resolvedSubId };
      }

      throw new Error(`3X-UI addClient returned success=false: ${data.msg ?? "unknown reason"}`);
    }

    return { clientId, email, subId };
  }

  async updateClientSubscription(
    xuiClientId: string,
    email: string,
    subId: string
  ): Promise<void> {
    let res = await this.updateClientViaModernApi(xuiClientId, email, {
      email,
      subId,
      flow: XuiClient.CLIENT_FLOW,
      enable: true,
      expiryTime: 0,
      totalGB: 0,
    });

    if (!res) {
      res = await this.request(
        `/panel/api/inbounds/updateClient/${xuiClientId}`,
        {
          method: "POST",
          body: JSON.stringify({
            id: config.xui.inboundId,
            settings: JSON.stringify({
              clients: [
                {
                  id: xuiClientId,
                  email,
                  subId,
                  flow: XuiClient.CLIENT_FLOW,
                  enable: true,
                  expiryTime: 0,
                  totalGB: 0,
                },
              ],
            }),
          }),
        }
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI updateClientSubscription failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      throw new Error(`3X-UI updateClientSubscription returned success=false: ${data.msg ?? "unknown reason"}`);
    }
  }

  async disableClient(xuiClientId: string, email: string): Promise<void> {
    let res = await this.updateClientViaModernApi(xuiClientId, email, {
      email,
      flow: XuiClient.CLIENT_FLOW,
      enable: false,
    });

    if (!res) {
      res = await this.request(
        `/panel/api/inbounds/updateClient/${xuiClientId}`,
        {
          method: "POST",
          body: JSON.stringify({
            id: config.xui.inboundId,
            settings: JSON.stringify({
              clients: [{ id: xuiClientId, email, flow: XuiClient.CLIENT_FLOW, enable: false }],
            }),
          }),
        }
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`3X-UI disableClient failed: ${res.status} ${body}`);
    }

    const data = await res.json() as XuiApiResponse;
    if (!data.success) {
      throw new Error(`3X-UI disableClient returned success=false: ${data.msg ?? "unknown reason"}`);
    }
  }

  async getSubscriptionUrl(subId: string): Promise<string> {
    return `${config.xui.subBaseUrl}/sub/${subId}`;
  }
}

export const xuiClient = new XuiClient();
