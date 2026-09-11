import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAID_WHITELIST_TRAFFIC_LIMIT_BYTES,
  resolveVpnTrafficLimitBytes,
} from "./vpn-traffic-policy.js";

test("defaults an unset paid whitelist limit to 10 GiB", () => {
  assert.equal(
    resolveVpnTrafficLimitBytes("paid", "whitelist", null),
    DEFAULT_PAID_WHITELIST_TRAFFIC_LIMIT_BYTES,
  );
  assert.equal(
    resolveVpnTrafficLimitBytes("paid", "whitelist-yandex", null),
    DEFAULT_PAID_WHITELIST_TRAFFIC_LIMIT_BYTES,
  );
});

test("keeps an unset non-whitelist limit unlimited", () => {
  assert.equal(resolveVpnTrafficLimitBytes("paid", "direct", null), null);
  assert.equal(resolveVpnTrafficLimitBytes("club", "whitelist", null), null);
  assert.equal(resolveVpnTrafficLimitBytes("router", "default", null), null);
});

test("preserves an explicit per-inbound limit including unlimited", () => {
  assert.equal(resolveVpnTrafficLimitBytes("paid", "whitelist", 25n), 25n);
  assert.equal(resolveVpnTrafficLimitBytes("paid", "whitelist", 0n), 0n);
});
