import type { VpnPendingAccessGrant } from "@prisma/client";
import { prisma } from "../database.js";

function normalizeUsername(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}

export class VpnPendingAccessGrantRepository {
  async save(username: string, grantedByTelegramId: bigint): Promise<VpnPendingAccessGrant> {
    const normalizedUsername = normalizeUsername(username);
    return prisma.vpnPendingAccessGrant.upsert({
      where: { normalizedUsername },
      create: {
        username,
        normalizedUsername,
        grantedByTelegramId,
      },
      update: {
        username,
        grantedByTelegramId,
        claimedByUserId: null,
        claimedAt: null,
      },
    });
  }

  async findPending(username: string): Promise<VpnPendingAccessGrant | null> {
    return prisma.vpnPendingAccessGrant.findFirst({
      where: {
        normalizedUsername: normalizeUsername(username),
        claimedAt: null,
      },
    });
  }

  async deletePending(username: string): Promise<boolean> {
    const result = await prisma.vpnPendingAccessGrant.deleteMany({
      where: {
        normalizedUsername: normalizeUsername(username),
        claimedAt: null,
      },
    });
    return result.count > 0;
  }

  async markClaimed(id: number, userId: number): Promise<boolean> {
    const result = await prisma.vpnPendingAccessGrant.updateMany({
      where: { id, claimedAt: null },
      data: { claimedByUserId: userId, claimedAt: new Date() },
    });
    return result.count === 1;
  }
}

export const vpnPendingAccessGrantRepository = new VpnPendingAccessGrantRepository();
