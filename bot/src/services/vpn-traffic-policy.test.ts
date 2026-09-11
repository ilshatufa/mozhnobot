import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES,
  resolveVpnTrafficLimitBytes,
} from "./vpn-traffic-policy.js";

test("defaults an unset whitelist limit to 10 GiB", () => {
  assert.equal(
    resolveVpnTrafficLimitBytes("whitelist", null),
    DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES,
  );
  assert.equal(
    resolveVpnTrafficLimitBytes("whitelist-yandex", null),
    DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES,
  );
});

test("keeps an unset non-whitelist limit unlimited", () => {
  assert.equal(resolveVpnTrafficLimitBytes("direct", null), null);
  assert.equal(resolveVpnTrafficLimitBytes("default", null), null);
});

test("preserves an explicit per-inbound limit including unlimited", () => {
  assert.equal(resolveVpnTrafficLimitBytes("whitelist", 25n), 25n);
  assert.equal(resolveVpnTrafficLimitBytes("whitelist", 0n), 0n);
});
