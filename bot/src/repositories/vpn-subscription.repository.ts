import type { Prisma } from "@prisma/client";
import { prisma } from "../database.js";

const vpnSubscriptionForSync = {
  user: true,
  product: {
    include: {
      inbounds: {
        include: { inbound: true },
        orderBy: { position: "asc" },
      },
    },
  },
  inboundStates: true,
} satisfies Prisma.VpnSubscriptionInclude;

export type VpnSubscriptionForSync = Prisma.VpnSubscriptionGetPayload<{
  include: typeof vpnSubscriptionForSync;
}>;

export class VpnSubscriptionRepository {
  async findManyForSync(filters: {
    subscriptionId?: number;
    userId?: number;
  } = {}): Promise<VpnSubscriptionForSync[]> {
    return prisma.vpnSubscription.findMany({
      where: {
        ...(filters.subscriptionId === undefined ? {} : { id: filters.subscriptionId }),
        ...(filters.userId === undefined ? {} : { userId: filters.userId }),
      },
      include: vpnSubscriptionForSync,
      orderBy: { id: "asc" },
    });
  }
}

export const vpnSubscriptionRepository = new VpnSubscriptionRepository();
