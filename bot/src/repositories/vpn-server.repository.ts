import { VpnProvider, type VpnServer } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";

export class VpnServerRepository {
  async ensureConfiguredServers(): Promise<void> {
    const configuredCodes = config.vpnServers.xui.servers.map((server) => server.code);

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

    await prisma.vpnServer.updateMany({
      where: {
        provider: VpnProvider.XUI,
        code: { notIn: configuredCodes },
      },
      data: { isActive: false },
    });
  }

  async findActiveByCode(code: string): Promise<VpnServer | null> {
    await this.ensureConfiguredServers();
    return prisma.vpnServer.findFirst({ where: { code, isActive: true } });
  }

  async findActiveMany(): Promise<VpnServer[]> {
    await this.ensureConfiguredServers();
    return prisma.vpnServer.findMany({
      where: { provider: VpnProvider.XUI, isActive: true },
      orderBy: { id: "asc" },
    });
  }
}

export const vpnServerRepository = new VpnServerRepository();
