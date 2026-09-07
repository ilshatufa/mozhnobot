import { VpnProvider, type VpnKey, type VpnServer } from "@prisma/client";
import { prisma } from "../database.js";

export class VpnKeyRepository {
  async findActiveByUserId(userId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        userId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  async findActiveByUserAndServer(userId: number, serverId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        userId,
        serverId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveLegacyXuiByUser(userId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        userId,
        serverId: null,
        provider: VpnProvider.XUI,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveManyByUserId(userId: number): Promise<Array<VpnKey & { server: VpnServer | null }>> {
    return prisma.vpnKey.findMany({
      where: {
        userId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { server: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(data: {
    userId: number;
    serverId: number;
    provider: VpnProvider;
    xuiClientId: string;
    providerClientId: string;
    providerPeerId: string;
    subId: string;
    subscriptionUrl: string;
    expiresAt: Date | null;
  }): Promise<VpnKey> {
    return prisma.vpnKey.create({ data });
  }

  async updateSubscription(id: number, subId: string, subscriptionUrl: string): Promise<VpnKey> {
    return prisma.vpnKey.update({
      where: { id },
      data: { subId, subscriptionUrl },
    });
  }

  async updateXuiSubscription(
    id: number,
    data: {
      xuiClientId: string;
      providerClientId: string;
      providerPeerId: string | null;
      subId: string;
      subscriptionUrl: string;
      expiresAt: Date | null;
    }
  ): Promise<VpnKey> {
    return prisma.vpnKey.update({ where: { id }, data });
  }

  async attachServer(id: number, serverId: number): Promise<VpnKey> {
    return prisma.vpnKey.update({
      where: { id },
      data: { serverId, provider: VpnProvider.XUI },
    });
  }

  async updateTraffic(id: number, trafficUsedBytes: bigint): Promise<void> {
    await prisma.vpnKey.update({
      where: { id },
      data: { trafficUsedBytes, lastSyncedAt: new Date() },
    });
  }

  async deactivateAllForUser(userId: number): Promise<void> {
    await prisma.vpnKey.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
  }

  async findLatestByUserId(userId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
}

export const vpnKeyRepository = new VpnKeyRepository();
