import {
  VpnProvider,
  VpnSubscriptionInboundStatus,
  type VpnKey,
} from "@prisma/client";
import { prisma } from "../database.js";

type BackfillKey = VpnKey & {
  server: { id: number; code: string } | null;
};

interface BackfillGroup {
  productCode: "club" | "router";
  subscriptionUserId: number;
  keys: BackfillKey[];
}

export interface VpnSubscriptionBackfillPlan {
  clubSubscriptions: number;
  routerSubscriptions: number;
  keys: number;
  inboundStates: number;
  errors: string[];
}

export class VpnSubscriptionBackfillService {
  async plan(input: {
    routerTechnicalUserId: number;
    routerOwnerUserId: number;
  }): Promise<VpnSubscriptionBackfillPlan> {
    const groups = await this.groups(input);
    const errors: string[] = [];
    let keys = 0;
    let inboundStates = 0;

    for (const group of groups) {
      const validation = await this.validateGroup(group);
      errors.push(...validation.errors);
      keys += group.keys.length;
      inboundStates += validation.inboundStates;
    }

    return {
      clubSubscriptions: groups.filter((group) => group.productCode === "club").length,
      routerSubscriptions: groups.filter((group) => group.productCode === "router").length,
      keys,
      inboundStates,
      errors,
    };
  }

  async apply(input: {
    routerTechnicalUserId: number;
    routerOwnerUserId: number;
  }): Promise<VpnSubscriptionBackfillPlan> {
    const groups = await this.groups(input);
    const plan = await this.plan(input);
    if (plan.errors.length > 0) {
      throw new Error(`VPN subscription backfill validation failed:\n${plan.errors.join("\n")}`);
    }

    for (const group of groups) {
      await this.applyGroup(group);
    }
    return plan;
  }

  private async groups(input: {
    routerTechnicalUserId: number;
    routerOwnerUserId: number;
  }): Promise<BackfillGroup[]> {
    if (input.routerTechnicalUserId === input.routerOwnerUserId) {
      throw new Error("Router technical and owner user IDs must be different");
    }
    const users = await prisma.user.findMany({
      where: { id: { in: [input.routerTechnicalUserId, input.routerOwnerUserId] } },
      select: { id: true },
    });
    const userIds = new Set(users.map((user) => user.id));
    if (!userIds.has(input.routerTechnicalUserId)) {
      throw new Error(`Router technical user ${input.routerTechnicalUserId} does not exist`);
    }
    if (!userIds.has(input.routerOwnerUserId)) {
      throw new Error(`Router owner user ${input.routerOwnerUserId} does not exist`);
    }

    const activeKeys = await prisma.vpnKey.findMany({
      where: {
        provider: VpnProvider.XUI,
        isActive: true,
        serverId: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { server: { select: { id: true, code: true } } },
      orderBy: [{ userId: "asc" }, { serverId: "asc" }, { id: "asc" }],
    });
    const clubKeysByUser = new Map<number, BackfillKey[]>();
    const routerKeys: BackfillKey[] = [];

    for (const key of activeKeys) {
      if (key.userId === input.routerTechnicalUserId) {
        routerKeys.push(key);
        continue;
      }
      const current = clubKeysByUser.get(key.userId) ?? [];
      current.push(key);
      clubKeysByUser.set(key.userId, current);
    }

    if (routerKeys.length === 0) {
      throw new Error(`Router technical user ${input.routerTechnicalUserId} has no active XUI keys`);
    }

    const groups: BackfillGroup[] = [...clubKeysByUser.entries()].map(([userId, keys]) => ({
      productCode: "club",
      subscriptionUserId: userId,
      keys,
    }));
    if (routerKeys.length > 0) {
      groups.push({
        productCode: "router",
        subscriptionUserId: input.routerOwnerUserId,
        keys: routerKeys,
      });
    }
    return groups;
  }

  private async validateGroup(group: BackfillGroup): Promise<{
    errors: string[];
    inboundStates: number;
  }> {
    const errors: string[] = [];
    const product = await prisma.vpnProduct.findUnique({
      where: { code: group.productCode },
      include: {
        inbounds: {
          include: { inbound: { include: { server: true } } },
        },
      },
    });
    if (!product) {
      return { errors: [`VPN product ${group.productCode} does not exist`], inboundStates: 0 };
    }

    const expectedServerCodes = new Set(product.inbounds.map((item) => item.inbound.server.code));
    const keysByServerCode = new Map<string, BackfillKey>();
    for (const key of group.keys) {
      if (!key.server) {
        errors.push(`VPN key ${key.id} has no server`);
        continue;
      }
      if (!expectedServerCodes.has(key.server.code)) {
        errors.push(
          `VPN key ${key.id} uses server ${key.server.code}, which is not in product ${group.productCode}`,
        );
      }
      if (group.productCode === "router" && !key.providerClientId?.startsWith("router_")) {
        errors.push(`VPN key ${key.id} does not look like a router client`);
      }
      if (group.productCode === "club" && key.providerClientId?.startsWith("router_")) {
        errors.push(`Router-like VPN key ${key.id} was assigned to a club subscription`);
      }
      if (keysByServerCode.has(key.server.code)) {
        errors.push(
          `User ${group.subscriptionUserId} has duplicate ${group.productCode} keys for server ${key.server.code}`,
        );
      }
      keysByServerCode.set(key.server.code, key);
      if (key.subscriptionId !== null) {
        const existing = await prisma.vpnSubscription.findUnique({ where: { id: key.subscriptionId } });
        if (!existing || existing.userId !== group.subscriptionUserId || existing.productId !== product.id) {
          errors.push(`VPN key ${key.id} already belongs to another subscription`);
        }
      }
    }

    for (const item of product.inbounds) {
      if (item.isRequired && !keysByServerCode.has(item.inbound.server.code)) {
        errors.push(
          `User ${group.subscriptionUserId} has no ${group.productCode} key for server ${item.inbound.server.code}`,
        );
      }
    }
    const entryKey = keysByServerCode.get("nl");
    if (!entryKey?.subId) {
      errors.push(`User ${group.subscriptionUserId} has no NL subscription token for ${group.productCode}`);
    } else {
      const tokenOwner = await prisma.vpnSubscription.findUnique({ where: { token: entryKey.subId } });
      if (tokenOwner && (tokenOwner.userId !== group.subscriptionUserId || tokenOwner.productId !== product.id)) {
        errors.push(`NL subscription token for user ${group.subscriptionUserId} is already used by another subscription`);
      }
    }

    return { errors, inboundStates: product.inbounds.length };
  }

  private async applyGroup(group: BackfillGroup): Promise<void> {
    const product = await prisma.vpnProduct.findUniqueOrThrow({
      where: { code: group.productCode },
      include: {
        inbounds: {
          include: { inbound: { include: { server: true } } },
        },
      },
    });
    const keysByServerCode = new Map(
      group.keys
        .filter((key): key is BackfillKey & { server: { id: number; code: string } } => key.server !== null)
        .map((key) => [key.server.code, key]),
    );
    const token = keysByServerCode.get("nl")?.subId;
    if (!token) throw new Error(`Validated ${group.productCode} group has no NL token`);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.vpnSubscription.findUnique({
        where: {
          userId_productId: {
            userId: group.subscriptionUserId,
            productId: product.id,
          },
        },
      });
      if (existing && existing.token !== token) {
        throw new Error(
          `Existing ${group.productCode} subscription for user ${group.subscriptionUserId} has a different token`,
        );
      }
      const subscription = existing ?? await tx.vpnSubscription.create({
        data: {
          userId: group.subscriptionUserId,
          productId: product.id,
          token,
          appliedRevision: product.revision,
          lastSyncedAt: new Date(),
        },
      });

      for (const key of group.keys) {
        await tx.vpnKey.update({
          where: { id: key.id },
          data: { subscriptionId: subscription.id },
        });
      }
      for (const item of product.inbounds) {
        const key = keysByServerCode.get(item.inbound.server.code);
        if (!key) throw new Error(`Validated ${group.productCode} group lost a required key`);
        await tx.vpnSubscriptionInbound.upsert({
          where: {
            subscriptionId_inboundId: {
              subscriptionId: subscription.id,
              inboundId: item.inboundId,
            },
          },
          create: {
            subscriptionId: subscription.id,
            inboundId: item.inboundId,
            keyId: key.id,
            status: key.isActive
              ? VpnSubscriptionInboundStatus.ACTIVE
              : VpnSubscriptionInboundStatus.DISABLED,
            lastSyncedAt: new Date(),
          },
          update: {
            keyId: key.id,
            status: key.isActive
              ? VpnSubscriptionInboundStatus.ACTIVE
              : VpnSubscriptionInboundStatus.DISABLED,
            lastSyncedAt: new Date(),
            lastError: null,
          },
        });
      }
    });
  }
}

export const vpnSubscriptionBackfillService = new VpnSubscriptionBackfillService();
