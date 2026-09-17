import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { VpnProductAccessPolicy, VpnSubscriptionInboundStatus, VpnTrialStatus } from "@prisma/client";
import { prisma } from "../database.js";
import { vpnAccessSyncService } from "./vpn-access-sync.service.js";
import { vpnTrialService } from "./vpn-trial.service.js";

const integrationDatabaseUrl = process.env.VPN_ACCESS_INTEGRATION_DATABASE_URL;

test("starts the seven-day trial only after provisioning and never extends it", {
  skip: integrationDatabaseUrl ? false : "VPN access integration database is not configured",
}, async () => {
  await prisma.$connect();
  const syncTarget = vpnAccessSyncService as unknown as {
    sync(filters: { subscriptionId?: number; now?: Date }): Promise<Array<{
      provisioning?: { success: boolean; errors: string[] };
    }>>;
  };
  const originalSync = syncTarget.sync.bind(vpnAccessSyncService);
  let userId: number | null = null;
  let subscriptionId: number | null = null;
  try {
    await prisma.vpnProduct.upsert({
      where: { code: "paid" },
      create: {
        code: "paid",
        name: "МОЖНО VPN",
        accessPolicy: VpnProductAccessPolicy.PAID_BALANCE,
      },
      update: { isActive: true, accessPolicy: VpnProductAccessPolicy.PAID_BALANCE },
    });
    const user = await prisma.user.create({
      data: {
        telegramId: BigInt(`7${Date.now()}`),
        username: `trial_${randomUUID().slice(0, 8)}`,
      },
    });
    userId = user.id;
    const product = await prisma.vpnProduct.findUniqueOrThrow({ where: { code: "paid" } });
    const vpnServer = await prisma.vpnServer.create({
      data: {
        code: `trial-${randomUUID()}`,
        name: "Trial integration server",
        apiBaseUrl: "http://127.0.0.1:1",
      },
    });
    const inbounds = await Promise.all([1, 2, 3, 4].map((position) => prisma.vpnInbound.create({
      data: {
        serverId: vpnServer.id,
        code: `trial-${randomUUID()}`,
        providerInboundId: position,
        name: `Trial ${position}`,
        port: 20000 + position,
        products: { create: { productId: product.id, position } },
      },
    })));
    let shouldFail = true;
    syncTarget.sync = async (filters) => {
      if (!shouldFail && filters.subscriptionId) {
        await prisma.vpnSubscriptionInboundState.createMany({
          data: inbounds.map((inbound) => ({
            subscriptionId: filters.subscriptionId as number,
            inboundId: inbound.id,
            status: VpnSubscriptionInboundStatus.ACTIVE,
          })),
          skipDuplicates: true,
        });
      }
      return [{
        provisioning: shouldFail
          ? { success: false, errors: ["provider unavailable"] }
          : { success: true, errors: [] },
      }];
    };

    const acceptedAt = new Date("2026-09-17T12:00:00Z");
    const failed = await vpnTrialService.startTrial({
      user,
      termsVersion: "trial-v1",
      acceptedAt,
      now: acceptedAt,
    });
    assert.equal(failed.status, "PROVISIONING");
    assert.equal(failed.trial.startedAt, null);
    assert.equal(failed.trial.endsAt, null);
    subscriptionId = failed.trial.vpnSubscriptionId;

    shouldFail = false;
    const activatedAt = new Date("2026-09-17T12:05:00Z");
    const [active, concurrentActive] = await Promise.all([
      vpnTrialService.startTrial({
        user,
        termsVersion: "trial-v1",
        acceptedAt: activatedAt,
        now: activatedAt,
      }),
      vpnTrialService.startTrial({
        user,
        termsVersion: "trial-v1",
        acceptedAt: activatedAt,
        now: activatedAt,
      }),
    ]);
    assert.equal(active.status, "ACTIVE");
    assert.equal(concurrentActive.status, "ACTIVE");
    assert.equal(active.trial.startedAt?.toISOString(), activatedAt.toISOString());
    assert.equal(active.trial.endsAt?.toISOString(), "2026-09-24T12:05:00.000Z");
    assert.equal(concurrentActive.trial.endsAt?.toISOString(), active.trial.endsAt?.toISOString());

    const repeated = await vpnTrialService.startTrial({
      user,
      termsVersion: "trial-v2",
      acceptedAt: new Date("2026-09-18T12:05:00Z"),
      now: new Date("2026-09-18T12:05:00Z"),
    });
    assert.equal(repeated.status, "ACTIVE");
    assert.equal(repeated.trial.endsAt?.toISOString(), active.trial.endsAt?.toISOString());
    assert.equal(
      (await prisma.vpnTrial.findUniqueOrThrow({ where: { id: active.trial.id } })).status,
      VpnTrialStatus.ACTIVE,
    );
  } finally {
    syncTarget.sync = originalSync;
    if (subscriptionId !== null) {
      await prisma.vpnSubscriptionInboundState.deleteMany({ where: { subscriptionId } });
      await prisma.vpnTrial.deleteMany({ where: { vpnSubscriptionId: subscriptionId } });
      await prisma.vpnSubscription.deleteMany({ where: { id: subscriptionId } });
    }
    const trialProducts = await prisma.vpnProduct.findUnique({
      where: { code: "paid" },
      include: { inbounds: { include: { inbound: true } } },
    });
    const ownInboundIds = trialProducts?.inbounds
      .filter((item) => item.inbound.code.startsWith("trial-"))
      .map((item) => item.inboundId) ?? [];
    if (ownInboundIds.length > 0) {
      await prisma.vpnProductInbound.deleteMany({ where: { inboundId: { in: ownInboundIds } } });
      await prisma.vpnInbound.deleteMany({ where: { id: { in: ownInboundIds } } });
    }
    await prisma.vpnServer.deleteMany({ where: { code: { startsWith: "trial-" } } });
    if (userId !== null) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
