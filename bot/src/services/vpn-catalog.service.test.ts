import assert from "node:assert/strict";
import test from "node:test";
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

test("keeps paid direct and whitelist traffic in separate client groups", () => {
  const paid = INITIAL_VPN_PRODUCT_CATALOG.find((product) => product.code === "paid");
  assert.ok(paid);

  const nlDirect = paid.inbounds.find((item) => item.code === "paid-nl-direct");
  const whitelist = paid.inbounds.find((item) => item.code === "paid-nl-yandex-cdn");
  assert.equal(nlDirect?.clientGroup, "direct");
  assert.equal(nlDirect?.trafficLimitBytes, null);
  assert.equal(whitelist?.clientGroup, "whitelist");
});
