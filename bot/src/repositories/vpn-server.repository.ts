import { VpnProvider, type VpnServer } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";

export class VpnServerRepository {
  async ensureConfiguredServers(): Promise<void> {
    for (const server of config.vpnServers.xui.servers) {
      await prisma.vpnServer.upsert({
        where: { code: server.code },
        create: {
          provider: VpnProvider.XUI,
          code: server.code,
          name: server.name,
          apiBaseUrl: server.apiBaseUrl,
        },
        update: {
          provider: VpnProvider.XUI,
          name: server.name,
          apiBaseUrl: server.apiBaseUrl,
          isActive: true,
        },
      });
    }

    await prisma.vpnServer.upsert({
      where: { code: config.vpnServers.amneziya.code },
      create: {
        provider: VpnProvider.AMNEZIA,
        code: config.vpnServers.amneziya.code,
        name: config.vpnServers.amneziya.name,
        apiBaseUrl: config.vpnServers.amneziya.apiBaseUrl,
        apiTokenEnv: "VPN_AMNEZIA_API_TOKEN",
      },
      update: {
        provider: VpnProvider.AMNEZIA,
        name: config.vpnServers.amneziya.name,
        apiBaseUrl: config.vpnServers.amneziya.apiBaseUrl,
        apiTokenEnv: "VPN_AMNEZIA_API_TOKEN",
        isActive: true,
      },
    });
  }

  async findActiveByCode(code: string): Promise<VpnServer | null> {
    await this.ensureConfiguredServers();
    return prisma.vpnServer.findFirst({
      where: { code, isActive: true },
    });
  }

  async findActiveByProvider(provider: VpnProvider): Promise<VpnServer | null> {
    await this.ensureConfiguredServers();
    return prisma.vpnServer.findFirst({
      where: { provider, isActive: true },
      orderBy: { id: "asc" },
    });
  }

  async findActiveManyByProvider(provider: VpnProvider): Promise<VpnServer[]> {
    await this.ensureConfiguredServers();
    return prisma.vpnServer.findMany({
      where: { provider, isActive: true },
      orderBy: { id: "asc" },
    });
  }
}

export const vpnServerRepository = new VpnServerRepository();
