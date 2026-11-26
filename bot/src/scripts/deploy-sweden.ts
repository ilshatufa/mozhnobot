/** Prepare private Swedish access before exposing all three endpoints in subscriptions. */
import { VpnProvider, VpnSubscriptionInboundStatus } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { vpnSubscriptionRepository, type VpnSubscriptionForSync } from "../repositories/vpn-subscription.repository.js";
import { INITIAL_VPN_INBOUND_CATALOG, SWEDEN_INBOUNDS } from "../services/vpn-catalog.service.js";
import { vpnAccessProvisioner } from "../services/vpn-access-provisioner.js";
import { buildVpnAccessSyncPlan } from "../services/vpn-access-sync-plan.js";
import { resolveVpnEntitlement } from "../services/vpn-entitlement.js";

async function prepare() {
  const se = config.vpnServers.xui.servers.find((s) => s.code === "se");
  if (!se || se.inboundId !== 1 || se.clientApiMode !== "clients") throw new Error("Missing Swedish 3X-UI configuration");
  await prisma.$transaction(async (tx) => {
    const data = { name: se.name, apiBaseUrl: se.apiBaseUrl, isActive: true };
    const server = await tx.vpnServer.upsert({ where: { code: "se" }, update: data,
      create: { ...data, provider: VpnProvider.XUI, code: "se" } });
    for (const entry of INITIAL_VPN_INBOUND_CATALOG.filter((e) => e.serverCode === "se")) {
      const fields = { serverId: server.id, providerInboundId: entry.providerInboundId, port: entry.port,
        name: entry.name, publicProfile: entry.publicProfile, isActive: true };
      await tx.vpnInbound.upsert({ where: { code: entry.code }, update: fields, create: { ...fields, code: entry.code } });
    }
  });
}

async function main() {
  const stage = process.argv[2];
  if (!["prepare", "stage", "provision", "check", "activate", "rollback"].includes(stage)) throw new Error("Choose prepare, stage, provision, check, activate or rollback");
  if (stage === "prepare") { await prepare(); return; }
  if (stage === "rollback") {
    await prisma.$transaction(async (tx) => {
      for (const { product: code } of SWEDEN_INBOUNDS) {
        const product = await tx.vpnProduct.findUniqueOrThrow({ where: { code } });
        const inbound = await tx.vpnInbound.findUnique({ where: { code: code + "-se-direct" } });
        if (!inbound) continue;
        const removed = await tx.vpnProductInbound.deleteMany({ where: { productId: product.id, inboundId: inbound.id } });
        if (removed.count) await tx.vpnProduct.update({ where: { id: product.id }, data: { revision: { increment: 1 } } });
      }
    });
    return;
  }
  const subscriptions = stage === "stage" ? [] : await vpnSubscriptionRepository.findManyForSync();
  const products: { productId: number; inboundId: number }[] = [];
  const now = new Date();
  for (const { product: code } of SWEDEN_INBOUNDS) {
    const product = await prisma.vpnProduct.findUniqueOrThrow({ where: { code } });
    const inbound = await prisma.vpnInbound.findUniqueOrThrow({ where: { code: code + "-se-direct" }, include: { server: true } });
    const assignment = { productId: product.id, inboundId: inbound.id, isRequired: true,
      clientGroup: "direct", trafficLimitBytes: null, trafficResetDays: 0, position: 0,
      createdAt: now, updatedAt: now, inbound };
    let eligible = 0, missing = 0;
    for (const sub of subscriptions.filter((s) => s.productId === product.id)) {
      const scoped: VpnSubscriptionForSync = { ...sub,
        product: { ...sub.product, inbounds: [assignment] },
        keys: sub.keys.filter((k) => k.serverId === inbound.serverId),
        inboundStates: sub.inboundStates.filter((s) => s.inboundId === inbound.id) };
      const plan = buildVpnAccessSyncPlan({ now, entitlement: resolveVpnEntitlement(scoped, now),
        product: scoped.product, user: scoped.user, subscription: scoped });
      if (!plan.eligible) continue;
      eligible++;
      if (stage === "provision") {
        const errors = await vpnAccessProvisioner.ensureEligibleSubscription(scoped, plan);
        if (errors.length) throw new Error("Swedish provisioning failed for subscription " + sub.id + ": " + errors[0]);
      } else if (!scoped.inboundStates.some((s) => s.status === VpnSubscriptionInboundStatus.ACTIVE &&
          scoped.keys.some((k) => k.id === s.keyId && k.isActive && k.clientGroup === "direct"))) missing++;
    }
    console.log(JSON.stringify({ product: code, eligible, missing }));
    if (missing) throw new Error("Swedish access is not ready for " + code);
    products.push({ productId: product.id, inboundId: inbound.id });
  }
  if (stage === "activate" || stage === "stage") {
    await prisma.$transaction(async (tx) => {
      for (const ids of products) {
        const existing = await tx.vpnProductInbound.findUnique({ where: { productId_inboundId: ids } });
        if (existing) {
          if (existing.isRequired || stage === "stage") continue;
          await tx.vpnProductInbound.update({ where: { productId_inboundId: ids }, data: { isRequired: true } });
        } else {
          if (stage === "activate") throw new Error("Stage Swedish access before requiring it");
          const last = await tx.vpnProductInbound.aggregate({ where: { productId: ids.productId }, _max: { position: true } });
          await tx.vpnProductInbound.create({ data: { ...ids, clientGroup: "direct",
            position: (last._max.position ?? 0) + 1, isRequired: false, trafficLimitBytes: null, trafficResetDays: 0 } });
        }
        await tx.vpnProduct.update({ where: { id: ids.productId }, data: { revision: { increment: 1 } } });
      }
    }, { isolationLevel: "Serializable" });
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
