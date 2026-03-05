import type { VpnKey } from "@prisma/client";
import { prisma } from "../database.js";

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

  async create(data: {
    userId: number;
    xuiClientId: string;
    subId: string;
    subscriptionUrl: string;
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
