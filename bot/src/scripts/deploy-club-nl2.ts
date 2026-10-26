/** Stage only the new club node; keep all existing nodes and product links intact. */
import { VpnProvider, VpnSubscriptionInboundStatus } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { INITIAL_VPN_INBOUND_CATALOG } from "../services/vpn-catalog.service.js";
import { vpnSubscriptionRepository, type VpnSubscriptionForSync } from "../repositories/vpn-subscription.repository.js";
import { vpnAccessProvisioner } from "../services/vpn-access-provisioner.js";
import { buildVpnAccessSyncPlan } from "../services/vpn-access-sync-plan.js";
import { resolveVpnEntitlement } from "../services/vpn-entitlement.js";

const entry = INITIAL_VPN_INBOUND_CATALOG.find((item) => item.code === "club-nl2-direct")!;
const serverConfig = config.vpnServers.xui.servers.find((server) => server.code === "nl2");
const apply = process.argv.includes("--apply");
const stage = ["prepare", "provision", "activate", "rollback"].filter((s) => process.argv.includes("--" + s));

async function newInbound() {
  return prisma.vpnInbound.findUniqueOrThrow({
    where: { code: entry.code }, include: { server: true },
  });
}

async function scopedSubscriptions() {
  const inbound = await newInbound();
  const subscriptions = await vpnSubscriptionRepository.findManyForSync();
  return subscriptions.filter((s) => s.product.code === "club").map((subscription) => {
    const assignment: VpnSubscriptionForSync["product"]["inbounds"][number] = {
      productId: subscription.productId, inboundId: inbound.id, position: 5,
      isRequired: true, clientGroup: "direct", trafficLimitBytes: null, trafficResetDays: 0,
      createdAt: new Date(), updatedAt: new Date(), inbound,
    };
    const scoped: VpnSubscriptionForSync = {
      ...subscription,
      product: { ...subscription.product, inbounds: [assignment] },
      keys: subscription.keys.filter((key) => key.serverId === inbound.serverId),
      inboundStates: subscription.inboundStates.filter((state) => state.inboundId === inbound.id),
    };
    const now = new Date();
    const plan = buildVpnAccessSyncPlan({
      now, entitlement: resolveVpnEntitlement(scoped, now), user: scoped.user,
      product: scoped.product, subscription: scoped,
    });
    return { scoped, plan };
  });
}

async function main() {
  if (!serverConfig || serverConfig.inboundId !== 1) throw new Error("Configure nl2 with inboundId=1 first");
  if (stage.length > 1 || (apply && stage.length !== 1)) throw new Error("Choose one deployment stage with --apply");
  await prisma.$connect();
  if (!apply) {
    const inbound = await prisma.vpnInbound.findUnique({ where: { code: entry.code } });
    console.log(JSON.stringify({ mode: "dry-run", configured: true, prepared: Boolean(inbound), product: "club", port: entry.port }));
    return;
  }
  if (stage[0] === "prepare") {
    await prisma.$transaction(async (tx) => {
      const server = await tx.vpnServer.upsert({
        where: { code: "nl2" },
        create: { provider: VpnProvider.XUI, code: "nl2", name: serverConfig.name, apiBaseUrl: serverConfig.apiBaseUrl },
        update: { name: serverConfig.name, apiBaseUrl: serverConfig.apiBaseUrl, isActive: true },
      });
      await tx.vpnInbound.upsert({
        where: { code: entry.code },
        create: { serverId: server.id, code: entry.code, providerInboundId: entry.providerInboundId,
          name: entry.name, port: entry.port, publicProfile: entry.publicProfile },
        update: { serverId: server.id, providerInboundId: entry.providerInboundId,
          name: entry.name, port: entry.port, publicProfile: entry.publicProfile, isActive: true },
      });
    });
    console.log(JSON.stringify({ stage: "prepare", assignedToProduct: false }));
    return;
  }
  if (stage[0] === "provision") {
    const items = await scopedSubscriptions();
    let eligible = 0;
    const errors: string[] = [];
    for (const { scoped, plan } of items) {
      if (!plan.eligible) continue;
      eligible++;
      const result = await vpnAccessProvisioner.apply(scoped, plan);
      errors.push(...result.errors);
    }
    console.log(JSON.stringify({ stage: "provision", eligible, failed: errors.length, errors }));
    if (errors.length) process.exitCode = 1;
    return;
  }
  const inbound = await newInbound();
  const product = await prisma.vpnProduct.findUniqueOrThrow({ where: { code: "club" } });
  if (stage[0] === "activate") {
    const items = await scopedSubscriptions();
    const eligible = items.filter((item) => item.plan.eligible);
    const missing = eligible.filter(({ scoped }) => !scoped.inboundStates.some((state) =>
      state.status === VpnSubscriptionInboundStatus.ACTIVE && state.keyId !== null &&
      scoped.keys.some((key) => key.id === state.keyId && key.isActive)));
    if (missing.length) throw new Error(`Provision ${missing.length} remaining eligible subscriptions before activation`);
    await prisma.$transaction(async (tx) => {
      const previous = await tx.vpnProductInbound.findUnique({
        where: { productId_inboundId: { productId: product.id, inboundId: inbound.id } },
      });
      if (!previous) {
        await tx.vpnProductInbound.create({ data: {
          productId: product.id, inboundId: inbound.id, position: 5,
          isRequired: true, clientGroup: "direct", trafficLimitBytes: null, trafficResetDays: 0,
        } });
        const updated = await tx.vpnProduct.update({ where: { id: product.id }, data: { revision: { increment: 1 } } });
        await tx.vpnSubscription.updateMany({ where: { id: { in: eligible.map((item) => item.scoped.id) } },
          data: { appliedRevision: updated.revision } });
      }
    });
    console.log(JSON.stringify({ stage: "activate", product: "club", eligible: eligible.length, name: entry.name }));
    return;
  }
  if (stage[0] === "rollback") {
    await prisma.$transaction(async (tx) => {
      await tx.vpnProductInbound.deleteMany({ where: { productId: product.id, inboundId: inbound.id } });
      await tx.vpnInbound.update({ where: { id: inbound.id }, data: { isActive: false } });
      await tx.vpnProduct.update({ where: { id: product.id }, data: { revision: { increment: 1 } } });
    });
    console.log(JSON.stringify({ stage: "rollback", removedFromProduct: "club", customerKeysPreserved: true }));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
