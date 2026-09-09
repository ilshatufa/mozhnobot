import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import {
  ClubMembershipStatus,
  VpnProductAccessPolicy,
  VpnSubscriptionInboundStatus,
} from "@prisma/client";
import { prisma } from "../database.js";
import { vpnAccessSyncService } from "./vpn-access-sync.service.js";

const integrationDatabaseUrl = process.env.VPN_ACCESS_INTEGRATION_DATABASE_URL;

interface FakeClient {
  uuid: string;
  email: string;
  subId: string;
  inboundIds: number[];
  enable: boolean;
}

test("provisions, disables, restores and changes product inbounds", {
  skip: integrationDatabaseUrl ? false : "VPN access integration database is not configured",
}, async () => {
  const clients = new Map<string, FakeClient>();
  const server = http.createServer(async (req, res) => {
    const path = req.url ?? "";
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const send = (payload: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "POST" && path === "/panel/api/clients/add") {
      const email = String(body.client.email);
      clients.set(email, {
        uuid: String(body.client.id),
        email,
        subId: String(body.client.subId),
        inboundIds: body.inboundIds,
        enable: true,
      });
      send({ success: true });
      return;
    }

    const getMatch = path.match(/^\/panel\/api\/clients\/get\/(.+)$/);
    if (req.method === "GET" && getMatch) {
      const email = decodeURIComponent(getMatch[1]);
      const client = clients.get(email);
      send(client
        ? {
            success: true,
            obj: {
              client: { id: 1, uuid: client.uuid, email, subId: client.subId },
              inboundIds: client.inboundIds,
            },
          }
        : { success: false, msg: "client not found" });
      return;
    }

    const attachmentMatch = path.match(/^\/panel\/api\/clients\/(.+)\/(attach|detach)$/);
    if (req.method === "POST" && attachmentMatch) {
      const email = decodeURIComponent(attachmentMatch[1]);
      const client = clients.get(email);
      assert.ok(client);
      if (attachmentMatch[2] === "attach") {
        client.inboundIds = [...new Set([...client.inboundIds, ...body.inboundIds])];
      } else {
        client.inboundIds = client.inboundIds.filter((id) => !body.inboundIds.includes(id));
      }
      send({ success: true });
      return;
    }

    const enableMatch = path.match(/^\/panel\/api\/clients\/(bulkEnable|bulkDisable)$/);
    if (req.method === "POST" && enableMatch) {
      for (const email of body.emails) {
        const client = clients.get(email);
        assert.ok(client);
        client.enable = enableMatch[1] === "bulkEnable";
      }
      send({ success: true, obj: { changed: body.emails.length, skipped: [] } });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(19090, "127.0.0.1", resolve));
  await prisma.$connect();

  try {
    const user = await prisma.user.create({
      data: {
        telegramId: BigInt(`9${Date.now()}`),
        username: `integration_${randomUUID().slice(0, 8)}`,
        clubStatus: ClubMembershipStatus.MEMBER,
      },
    });
    const vpnServer = await prisma.vpnServer.create({
      data: {
        code: "integration",
        name: "Integration server",
        apiBaseUrl: "http://127.0.0.1:19090",
      },
    });
    const inbounds = await Promise.all([1, 5, 7].map((providerInboundId) => prisma.vpnInbound.create({
      data: {
        serverId: vpnServer.id,
        code: `integration-${randomUUID()}`,
        providerInboundId,
        name: `Inbound ${providerInboundId}`,
        port: 10000 + providerInboundId,
      },
    })));
    const product = await prisma.vpnProduct.create({
      data: {
        code: `integration-${randomUUID()}`,
        name: "Integration product",
        accessPolicy: VpnProductAccessPolicy.CLUB_MEMBERSHIP,
        inbounds: {
          create: [
            { inboundId: inbounds[0].id, position: 1 },
            { inboundId: inbounds[1].id, position: 2 },
          ],
        },
      },
    });
    const subscription = await prisma.vpnSubscription.create({
      data: { userId: user.id, productId: product.id, token: randomUUID() },
    });

    let result = await vpnAccessSyncService.sync({ subscriptionId: subscription.id });
    assert.equal(result[0]?.provisioning?.success, true);
    let key = await prisma.vpnKey.findFirstOrThrow({ where: { subscriptionId: subscription.id } });
    let client = clients.get(key.providerClientId ?? "");
    assert.ok(client);
    assert.deepEqual(client.inboundIds, [1, 5]);
    assert.equal(client.enable, true);
    assert.equal(await prisma.vpnSubscriptionInbound.count({
      where: { subscriptionId: subscription.id, status: VpnSubscriptionInboundStatus.ACTIVE },
    }), 2);

    await prisma.user.update({
      where: { id: user.id },
      data: { clubStatus: ClubMembershipStatus.LEFT },
    });
    result = await vpnAccessSyncService.sync({ subscriptionId: subscription.id });
    assert.equal(result[0]?.provisioning?.success, true);
    key = await prisma.vpnKey.findFirstOrThrow({ where: { subscriptionId: subscription.id } });
    client = clients.get(key.providerClientId ?? "");
    assert.equal(key.isActive, false);
    assert.equal(client?.enable, false);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { clubStatus: ClubMembershipStatus.MEMBER },
      }),
      prisma.vpnProductInbound.create({
        data: { productId: product.id, inboundId: inbounds[2].id, position: 3 },
      }),
      prisma.vpnProduct.update({ where: { id: product.id }, data: { revision: 2 } }),
    ]);
    result = await vpnAccessSyncService.sync({ subscriptionId: subscription.id });
    assert.equal(result[0]?.provisioning?.success, true);
    key = await prisma.vpnKey.findFirstOrThrow({ where: { subscriptionId: subscription.id } });
    client = clients.get(key.providerClientId ?? "");
    assert.equal(key.isActive, true);
    assert.equal(client?.enable, true);
    assert.deepEqual(client?.inboundIds, [1, 5, 7]);

    await prisma.$transaction([
      prisma.vpnProductInbound.delete({
        where: { productId_inboundId: { productId: product.id, inboundId: inbounds[1].id } },
      }),
      prisma.vpnProduct.update({ where: { id: product.id }, data: { revision: 3 } }),
    ]);
    result = await vpnAccessSyncService.sync({ subscriptionId: subscription.id });
    assert.equal(result[0]?.provisioning?.success, true);
    client = clients.get(key.providerClientId ?? "");
    assert.deepEqual(client?.inboundIds, [1, 7]);
    assert.equal(await prisma.vpnSubscriptionInbound.findUniqueOrThrow({
      where: {
        subscriptionId_inboundId: {
          subscriptionId: subscription.id,
          inboundId: inbounds[1].id,
        },
      },
    }).then((state) => state.status), VpnSubscriptionInboundStatus.DISABLED);
  } finally {
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
