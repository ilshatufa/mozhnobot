import type { VpnKey, VpnProvider, VpnServer } from "@prisma/client";
import { prisma } from "../database.js";

type AmneziyaKeyWithServerAndUser = VpnKey & {
  server: VpnServer | null;
  user: {
    id: number;
    telegramId: bigint;
    vpnTrafficLimitBytes: bigint | null;
  };
};

export class VpnKeyRepository {
  async findActiveByUserId(userId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async findActiveByUserAndServer(userId: number, serverId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        userId,
        serverId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveLegacyXuiByUser(userId: number): Promise<VpnKey | null> {
    return prisma.vpnKey.findFirst({
      where: {
        userId,
        serverId: null,
        provider: "XUI",
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveManyByUserId(userId: number): Promise<Array<VpnKey & { server: VpnServer | null }>> {
    return prisma.vpnKey.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        server: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveAmneziyaKeysForSync(): Promise<AmneziyaKeyWithServerAndUser[]> {
    return prisma.vpnKey.findMany({
      where: {
        provider: "AMNEZIA",
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        server: true,
        user: {
          select: {
            id: true,
            telegramId: true,
            vpnTrafficLimitBytes: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findActiveAmneziyaKeysByUserId(userId: number): Promise<AmneziyaKeyWithServerAndUser[]> {
    return prisma.vpnKey.findMany({
      where: {
        userId,
        provider: "AMNEZIA",
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        server: true,
        user: {
          select: {
            id: true,
            telegramId: true,
            vpnTrafficLimitBytes: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(data: {
    userId: number;
    serverId?: number | null;
    provider?: VpnProvider;
    xuiClientId: string;
    providerClientId?: string | null;
    providerPeerId?: string | null;
    subId?: string | null;
    subscriptionUrl: string;
    configText?: string | null;
    qrPngBase64?: string | null;
    trafficLimitBytes?: bigint | null;
    trafficUsedBytes?: bigint | null;
    disabledReason?: string | null;
    lastSyncedAt?: Date | null;
    expiresAt: Date;
  }): Promise<VpnKey> {
    return prisma.vpnKey.create({ data });
  }

  async updateSubscription(id: number, subId: string, subscriptionUrl: string): Promise<VpnKey> {
    return prisma.vpnKey.update({
      where: { id },
      data: { subId, subscriptionUrl },
    });
  }

  async attachServer(id: number, data: { serverId: number; provider: VpnProvider }): Promise<VpnKey> {
    return prisma.vpnKey.update({
      where: { id },
      data,
    });
  }

  async updateAmneziyaData(
    id: number,
    data: {
      providerPeerId?: string | null;
      providerClientId?: string | null;
      configText?: string | null;
      qrPngBase64?: string | null;
      trafficLimitBytes?: bigint | null;
      trafficUsedBytes?: bigint | null;
      disabledReason?: string | null;
      expiresAt?: Date;
      isActive?: boolean;
      lastSyncedAt?: Date | null;
    }
  ): Promise<VpnKey> {
    return prisma.vpnKey.update({
      where: { id },
      data,
    });
  }

  async updateTelegramFileIds(
    id: number,
    data: {
      telegramQrFileId?: string | null;
      telegramConfigFileId?: string | null;
    }
  ): Promise<VpnKey> {
    return prisma.vpnKey.update({
      where: { id },
      data,
    });
  }

  async deactivateAllForUser(userId: number): Promise<void> {
    await prisma.vpnKey.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
  }

  async deactivateById(id: number, disabledReason?: string): Promise<void> {
    await prisma.vpnKey.update({
      where: { id },
      data: {
        isActive: false,
        disabledReason,
        lastSyncedAt: new Date(),
      },
    });
  }

  async deactivateActiveAmneziyaByUserId(userId: number, disabledReason: string): Promise<void> {
    await prisma.vpnKey.updateMany({
      where: {
        userId,
        provider: "AMNEZIA",
        isActive: true,
      },
      data: {
        isActive: false,
        disabledReason,
        lastSyncedAt: new Date(),
      },
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
