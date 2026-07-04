import { config } from "../config.js";

interface AmneziyaApiTarget {
  apiBaseUrl: string;
}

export interface AmneziyaPeer {
  peerId: string;
  client: string | null;
  assignedIp: string;
  enabled: boolean;
  deleted: boolean;
  latestHandshakeAt: string | null;
  endpoint: string | null;
  rxBytes: number;
  txBytes: number;
  totalRxBytes: number;
  totalTxBytes: number;
  trafficLimitBytes: number | null;
  trafficUsedBytes: number;
  display: {
    rx: string;
    tx: string;
    trafficUsed: string;
    trafficLimit: string | null;
  };
  expiresAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
  alreadyExists?: boolean;
  config?: string;
}

interface AmneziyaConfigResponse {
  peerId: string;
  client: string | null;
  config: string;
}

interface AmneziyaQrResponse {
  peerId: string;
  client: string | null;
  qrPngBase64: string;
}

interface AmneziyaDownloadLinkResponse {
  url: string;
  expiresAt: string;
}

export class AmneziyaClient {
  private baseUrl(target?: AmneziyaApiTarget | null): string {
    return (target?.apiBaseUrl ?? config.vpnServers.amneziya.apiBaseUrl).replace(/\/+$/, "");
  }

  private get token(): string {
    if (!config.vpnServers.amneziya.apiToken) {
      throw new Error("VPN_AMNEZIA_API_TOKEN is not configured");
    }
    return config.vpnServers.amneziya.apiToken;
  }

  buildClientId(telegramId: bigint): string {
    return `tg_${telegramId}`;
  }

  buildConfigFileName(serverCode: string): string {
    return `amneziya-${serverCode}.mozhno.org.conf`;
  }

  private async request<T>(target: AmneziyaApiTarget | null | undefined, path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl(target)}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Amnezia API request failed: ${res.status} ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async createPeer(target: AmneziyaApiTarget, data: {
    client: string;
    expiresAt: Date;
    trafficLimitBytes: bigint | null;
  }): Promise<AmneziyaPeer> {
    return this.request<AmneziyaPeer>(target, "/peers", {
      method: "POST",
      body: JSON.stringify({
        client: data.client,
        expiresAt: data.expiresAt.toISOString(),
        trafficLimitBytes: data.trafficLimitBytes === null ? null : Number(data.trafficLimitBytes),
      }),
    });
  }

  async getPeerByClient(target: AmneziyaApiTarget, client: string): Promise<AmneziyaPeer> {
    return this.request<AmneziyaPeer>(target, `/peers/by-client/${encodeURIComponent(client)}`);
  }

  async getConfig(target: AmneziyaApiTarget, client: string): Promise<string> {
    const data = await this.request<AmneziyaConfigResponse>(
      target,
      `/peers/by-client/${encodeURIComponent(client)}/config`
    );
    return data.config;
  }

  async getQrPngBase64(target: AmneziyaApiTarget, client: string): Promise<string> {
    const data = await this.request<AmneziyaQrResponse>(
      target,
      `/peers/by-client/${encodeURIComponent(client)}/qr`
    );
    return data.qrPngBase64;
  }

  async createDownloadLink(target: AmneziyaApiTarget, client: string): Promise<AmneziyaDownloadLinkResponse> {
    return this.request<AmneziyaDownloadLinkResponse>(target, "/downloads", {
      method: "POST",
      body: JSON.stringify({ client }),
    });
  }

  async disablePeer(target: AmneziyaApiTarget | null | undefined, client: string, reason: string): Promise<AmneziyaPeer> {
    return this.request<AmneziyaPeer>(target, `/peers/by-client/${encodeURIComponent(client)}/disable`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }
}

export const amneziyaClient = new AmneziyaClient();
