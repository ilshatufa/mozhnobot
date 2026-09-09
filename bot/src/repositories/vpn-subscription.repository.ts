import type { Prisma, VpnSubscription } from "@prisma/client";
import { prisma } from "../database.js";

const vpnSubscriptionForSync = {
  user: true,
  product: {
    include: {
      inbounds: {
        include: {
          inbound: {
            include: { server: true },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  },
  keys: {
    include: { server: true },
    orderBy: { id: "asc" },
  },
  inboundStates: {
    include: {
      inbound: {
        include: { server: true },
      },
    },
  },
} satisfies Prisma.VpnSubscriptionInclude;

export type VpnSubscriptionForSync = Prisma.VpnSubscriptionGetPayload<{
  include: typeof vpnSubscriptionForSync;
}>;

export class VpnSubscriptionRepository {
  async findOrCreateForProduct(
    userId: number,
    productCode: string,
    token: string,
  ): Promise<{ subscription: VpnSubscription; alreadyExisted: boolean }> {
    const product = await prisma.vpnProduct.findFirst({
      where: { code: productCode, isActive: true },
      select: { id: true },
    });
    if (!product) throw new Error(`Active VPN product ${productCode} is not configured`);

    const existing = await prisma.vpnSubscription.findUnique({
      where: { userId_productId: { userId, productId: product.id } },
    });
    if (existing) return { subscription: existing, alreadyExisted: true };

    const subscription = await prisma.vpnSubscription.upsert({
      where: { userId_productId: { userId, productId: product.id } },
      create: { userId, productId: product.id, token },
      update: {},
    });
    return { subscription, alreadyExisted: subscription.token !== token };
  }

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
