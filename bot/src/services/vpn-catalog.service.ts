import { Prisma, VpnProductAccessPolicy } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";
import {
  PAID_YANDEX_CDN_PUBLIC_PROFILE,
  YANDEX_CDN_PUBLIC_PROFILE,
} from "./vpn-public-profile.js";

interface VpnInboundCatalogEntry {
  code: string;
  serverCode: string;
  providerInboundId: number;
  name: string;
  port: number;
  publicProfile?: Prisma.InputJsonObject;
}

interface VpnProductCatalogEntry {
  code: string;
  name: string;
  accessPolicy: VpnProductAccessPolicy;
  isActive: boolean;
  inbounds: Array<{
    code: string;
    clientGroup: string;
    trafficLimitBytes: bigint | null;
    trafficResetDays: number;
  }>;
}

function productInbound(
  code: string,
  clientGroup = "default",
  trafficLimitBytes: bigint | null = null,
  trafficResetDays = 0,
): VpnProductCatalogEntry["inbounds"][number] {
  return { code, clientGroup, trafficLimitBytes, trafficResetDays };
}

export const INITIAL_VPN_INBOUND_CATALOG: readonly VpnInboundCatalogEntry[] = [
  {
    code: "club-nl-direct",
    serverCode: "nl",
    providerInboundId: 1,
    name: "🇳🇱 МОЖНО • Нидерланды",
    port: 443,
  },
  {
    code: "club-nl-yandex-cdn",
    serverCode: "nl",
    providerInboundId: 5,
    name: "🇷🇺 МОЖНО • Белые списки — Нидерланды",
    port: 8443,
    publicProfile: YANDEX_CDN_PUBLIC_PROFILE as unknown as Prisma.InputJsonObject,
  },
  {
    code: "club-de-direct",
    serverCode: "de",
    providerInboundId: 1,
    name: "🇩🇪 МОЖНО • Германия",
    port: 443,
  },
  {
    code: "club-lv-direct",
    serverCode: "lv",
    providerInboundId: 1,
    name: "🇱🇻 МОЖНО • Латвия",
    port: 443,
  },
  {
    code: "router-nl",
    serverCode: "nl",
    providerInboundId: 4,
    name: "🇳🇱 МОЖНО • Роутер — Нидерланды",
    port: 10443,
  },
  {
    code: "router-de",
    serverCode: "de",
    providerInboundId: 3,
    name: "🇩🇪 МОЖНО • Роутер — Германия",
    port: 10443,
  },
  {
    code: "router-lv",
    serverCode: "lv",
    providerInboundId: 2,
    name: "🇱🇻 МОЖНО • Роутер — Латвия",
    port: 10443,
  },
  {
    code: "paid-nl-direct",
    serverCode: "nl",
    providerInboundId: 6,
    name: "🇳🇱 МОЖНО • Нидерланды",
    port: 11443,
  },
  {
    code: "paid-nl-yandex-cdn",
    serverCode: "nl",
    providerInboundId: 7,
    name: "🇷🇺 МОЖНО • Белые списки — Нидерланды",
    port: 12443,
    publicProfile: PAID_YANDEX_CDN_PUBLIC_PROFILE as unknown as Prisma.InputJsonObject,
  },
  {
    code: "paid-de-direct",
    serverCode: "de",
    providerInboundId: 4,
    name: "🇩🇪 МОЖНО • Германия",
    port: 11443,
  },
  {
    code: "paid-lv-direct",
    serverCode: "lv",
    providerInboundId: 3,
    name: "🇱🇻 МОЖНО • Латвия",
    port: 11443,
  },
] as const;

export const INITIAL_VPN_PRODUCT_CATALOG: readonly VpnProductCatalogEntry[] = [
  {
    code: "club",
    name: "МОЖНО Клуб",
    accessPolicy: VpnProductAccessPolicy.CLUB_MEMBERSHIP,
    isActive: true,
    inbounds: [
      productInbound("club-nl-direct"),
      productInbound("club-nl-yandex-cdn"),
      productInbound("club-de-direct"),
      productInbound("club-lv-direct"),
    ],
  },
  {
    code: "router",
    name: "МОЖНО Роутер",
    accessPolicy: VpnProductAccessPolicy.MANUAL,
    isActive: true,
    inbounds: [
      productInbound("router-nl"),
      productInbound("router-de"),
      productInbound("router-lv"),
    ],
  },
  {
    code: "paid",
    name: "МОЖНО VPN",
    accessPolicy: VpnProductAccessPolicy.PAID_BALANCE,
    isActive: true,
    inbounds: [
      productInbound("paid-nl-direct", "direct"),
      productInbound(
        "paid-nl-yandex-cdn",
        "whitelist",
        config.vpnAccessSync.paidWhitelistTrafficLimitBytes || null,
        config.vpnAccessSync.paidWhitelistTrafficResetDays,
      ),
      productInbound("paid-de-direct", "direct"),
      productInbound("paid-lv-direct", "direct"),
    ],
  },
] as const;

export interface VpnCatalogPlan {
  serverCodes: string[];
  missingServerCodes: string[];
  products: number;
  inbounds: number;
  productInboundLinks: number;
}

export class VpnCatalogService {
  async plan(): Promise<VpnCatalogPlan> {
    const serverCodes = [...new Set(INITIAL_VPN_INBOUND_CATALOG.map((item) => item.serverCode))];
    const servers = await prisma.vpnServer.findMany({
      where: { code: { in: serverCodes } },
      select: { code: true },
    });
    const existingCodes = new Set(servers.map((server) => server.code));

    return {
      serverCodes,
      missingServerCodes: serverCodes.filter((code) => !existingCodes.has(code)),
      products: INITIAL_VPN_PRODUCT_CATALOG.length,
      inbounds: INITIAL_VPN_INBOUND_CATALOG.length,
      productInboundLinks: INITIAL_VPN_PRODUCT_CATALOG.reduce(
        (sum, product) => sum + product.inbounds.length,
        0,
      ),
    };
  }

  async apply(): Promise<VpnCatalogPlan> {
    const plan = await this.plan();
    if (plan.missingServerCodes.length > 0) {
      throw new Error(`VPN catalog requires missing servers: ${plan.missingServerCodes.join(", ")}`);
    }

    await prisma.$transaction(async (tx) => {
      const servers = await tx.vpnServer.findMany({
        where: { code: { in: plan.serverCodes } },
        select: { id: true, code: true },
      });
      const serverIdByCode = new Map(servers.map((server) => [server.code, server.id]));
      const inboundIdByCode = new Map<string, number>();

      for (const item of INITIAL_VPN_INBOUND_CATALOG) {
        const serverId = serverIdByCode.get(item.serverCode);
        if (!serverId) throw new Error(`VPN server ${item.serverCode} disappeared during catalog update`);
        const inbound = await tx.vpnInbound.upsert({
          where: { code: item.code },
          create: {
            serverId,
            code: item.code,
            providerInboundId: item.providerInboundId,
            name: item.name,
            port: item.port,
            ...(item.publicProfile ? { publicProfile: item.publicProfile } : {}),
          },
          update: {
            serverId,
            providerInboundId: item.providerInboundId,
            name: item.name,
            port: item.port,
            ...(item.publicProfile ? { publicProfile: item.publicProfile } : {}),
          },
        });
        inboundIdByCode.set(item.code, inbound.id);
      }

      for (const item of INITIAL_VPN_PRODUCT_CATALOG) {
        const product = await tx.vpnProduct.upsert({
          where: { code: item.code },
          create: {
            code: item.code,
            name: item.name,
            accessPolicy: item.accessPolicy,
            isActive: item.isActive,
          },
          update: {
            name: item.name,
            accessPolicy: item.accessPolicy,
            isActive: item.isActive,
          },
        });

        const desiredInboundIds: number[] = [];
        for (const [index, assignment] of item.inbounds.entries()) {
          const inboundId = inboundIdByCode.get(assignment.code);
          if (!inboundId) throw new Error(`VPN inbound ${assignment.code} is missing from the catalog`);
          desiredInboundIds.push(inboundId);
          await tx.vpnProductInbound.upsert({
            where: { productId_inboundId: { productId: product.id, inboundId } },
            create: {
              productId: product.id,
              inboundId,
              position: index + 1,
              clientGroup: assignment.clientGroup,
              trafficLimitBytes: assignment.trafficLimitBytes,
              trafficResetDays: assignment.trafficResetDays,
            },
            update: {
              position: index + 1,
              isRequired: true,
              clientGroup: assignment.clientGroup,
              trafficLimitBytes: assignment.trafficLimitBytes,
              trafficResetDays: assignment.trafficResetDays,
            },
          });
        }
        await tx.vpnProductInbound.deleteMany({
          where: {
            productId: product.id,
            inboundId: { notIn: desiredInboundIds },
          },
        });
      }
    });

    return plan;
  }
}

export const vpnCatalogService = new VpnCatalogService();
