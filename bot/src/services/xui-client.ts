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
  settings?: string;
}

interface XuiInboundClient {
  id: string;
  email: string;
  subId: string | null;
}

export class XuiClient {
  private cookie: string | null = null;
  private static readonly CLIENT_FLOW = "xtls-rprx-vision";

  private get trafficLimitBytes(): number {
    return config.vpnTrafficLimitGb * 1024 * 1024 * 1024;
  }

  buildClientEmail(telegramId: bigint, username?: string | null): string {
    const normalized = (username ?? "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    return normalized ? `tg_${telegramId}_${normalized}` : `tg_${telegramId}`;
  }

  private get baseUrl(): string {
    return config.xui.baseUrl;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    await this.ensureAuthenticated();

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookie!,
        ...init?.headers,
      },
    });

    if (res.status === 401) {
      this.cookie = null;
      await this.ensureAuthenticated();
      return fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Cookie: this.cookie!,
          ...init?.headers,
        },
      });
    }

    return res;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.cookie) return;

    const res = await fetch(`${this.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: config.xui.username,
        password: config.xui.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`3X-UI login failed: ${res.status}`);
    }

    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error("3X-UI login: no session cookie returned");
    }

    this.cookie = setCookie.split(";")[0];
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(settingsRaw);
    } catch {
      throw new Error("3X-UI inbound settings JSON parse failed");
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
    telegramId: bigint,
    username: string | null,
    expiryTime: number
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
      expiryTime,
      totalGB: this.trafficLimitBytes,
    };

    const res = await this.request(
      "/panel/api/inbounds/addClient",
      {
        method: "POST",
        body: JSON.stringify({
          id: config.xui.inboundId,
          settings: JSON.stringify({ clients: [clientSettings] }),
        }),
      }
    );

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
        await this.updateClientSubscription(existing.id, email, expiryTime, resolvedSubId);
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
    expiryTime: number,
    subId: string
  ): Promise<void> {
    const res = await this.request(
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
                expiryTime,
                totalGB: this.trafficLimitBytes,
              },
            ],
          }),
        }),
      }
    );

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
    const res = await this.request(
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
