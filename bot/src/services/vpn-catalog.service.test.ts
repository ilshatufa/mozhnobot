import assert from "node:assert/strict";
import test from "node:test";
import { UNPUBLISHED_VPN_INBOUND_CODES } from "./vpn-public-profile.js";
import {
  INITIAL_VPN_INBOUND_CATALOG,
  INITIAL_VPN_PRODUCT_CATALOG,
} from "./vpn-catalog.service.js";

test("assigns every catalog inbound to exactly one VPN product", () => {
  const assignments = INITIAL_VPN_PRODUCT_CATALOG.flatMap((product) =>
    product.inbounds.map((inbound) => ({ product: product.code, inbound: inbound.code })),
  );
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    counts.set(assignment.inbound, (counts.get(assignment.inbound) ?? 0) + 1);
  }

  assert.equal(assignments.length, INITIAL_VPN_INBOUND_CATALOG.length);
  assert.deepEqual(
    [...counts.entries()].filter(([, count]) => count !== 1),
    [],
  );
});

test("uses direct as the canonical group for every non-whitelist inbound", () => {
  const assignments = INITIAL_VPN_PRODUCT_CATALOG.flatMap((product) => product.inbounds);
  assert.deepEqual(
    assignments
      .filter((item) => item.clientGroup !== "whitelist")
      .map((item) => item.clientGroup),
    Array(assignments.filter((item) => item.clientGroup !== "whitelist").length).fill("direct"),
  );
});

test("keeps paid direct and whitelist traffic in separate client groups", () => {
  const paid = INITIAL_VPN_PRODUCT_CATALOG.find((product) => product.code === "paid");
  assert.ok(paid);

  const nlDirect = paid.inbounds.find((item) => item.code === "paid-nl-direct");
  const whitelist = paid.inbounds.find((item) => item.code === "paid-nl-yandex-cdn");
  assert.equal(nlDirect?.clientGroup, "direct");
  assert.equal(nlDirect?.trafficLimitBytes, null);
  assert.equal(whitelist?.clientGroup, "whitelist");
  assert.equal(whitelist?.trafficResetDays, 30);
});

test("keeps club direct and whitelist traffic in separate client groups", () => {
  const club = INITIAL_VPN_PRODUCT_CATALOG.find((product) => product.code === "club");
  assert.ok(club);

  const nlDirect = club.inbounds.find((item) => item.code === "club-nl-direct");
  const whitelist = club.inbounds.find((item) => item.code === "club-nl-yandex-cdn");
  assert.equal(nlDirect?.clientGroup, "direct");
  assert.equal(nlDirect?.trafficLimitBytes, null);
  assert.equal(whitelist?.clientGroup, "whitelist");
  assert.equal(whitelist?.trafficLimitBytes, null);
  assert.equal(whitelist?.trafficResetDays, 30);
});

test("publishes only the Netherlands, Latvia and Sweden across all three products", () => {
  const byCode = new Map(INITIAL_VPN_INBOUND_CATALOG.map((item) => [item.code, item.serverCode]));
  for (const product of INITIAL_VPN_PRODUCT_CATALOG) {
    assert.ok(product.inbounds.every((item) => !UNPUBLISHED_VPN_INBOUND_CODES.includes(item.code)));
    const countries = product.inbounds.map((item) => byCode.get(item.code));
    assert.deepEqual([...new Set(countries)], ["nl", "lv", "se"]);
  }
});

test("keeps Swedish profiles product-specific and preserves HTTP connection reuse", () => {
  const expected = [["club", 1, 443], ["paid", 2, 11443], ["router", 3, 10443]] as const;
  for (const [product, id, port] of expected) {
    const entry = INITIAL_VPN_INBOUND_CATALOG.find((item) => item.code === product + "-se-direct");
    assert.equal(entry?.providerInboundId, id);
    assert.equal(entry.port, port);
    const publicProfile = entry.publicProfile as { host: string; port: number; query: { extra: { xmux: { maxConnections: number } } } };
    assert.equal(publicProfile.host, "xrayse.vpn.mozhno.org");
    assert.equal(publicProfile.port, port);
    assert.equal(publicProfile.query.extra.xmux.maxConnections, 1);
    assert.deepEqual(INITIAL_VPN_PRODUCT_CATALOG.filter((p) => p.inbounds.some((i) => i.code === entry.code)).map((p) => p.code), [product]);
  }
});
