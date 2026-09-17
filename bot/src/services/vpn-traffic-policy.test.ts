import assert from "node:assert/strict";
import test from "node:test";
import { VpnProductAccessPolicy } from "@prisma/client";
import {
  DEFAULT_WHITELIST_TRAFFIC_LIMIT_BYTES,
  resolveVpnTrafficLimitBytes,
  resolveVpnTrafficResetDays,
} from "./vpn-traffic-policy.js";

const ONE_GIB = 1024n ** 3n;

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

test("limits only the trial whitelist group to one GiB", () => {
  assert.equal(resolveVpnTrafficLimitBytes("whitelist", 10n * ONE_GIB, "TRIAL"), ONE_GIB);
  assert.equal(resolveVpnTrafficLimitBytes("direct", null, "TRIAL"), null);
});

test("resets paid whitelist traffic for paid and permanent free access", () => {
  const now = new Date("2026-09-11T12:00:00Z");
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.PAID_BALANCE,
      "whitelist",
      30,
      null,
      now,
    ),
    0,
  );
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.PAID_BALANCE,
      "whitelist",
      30,
      new Date("2026-09-10T12:00:00Z"),
      now,
    ),
    0,
  );
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.PAID_BALANCE,
      "whitelist",
      30,
      new Date("2026-10-10T12:00:00Z"),
      now,
      "PAID",
    ),
    30,
  );
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.PAID_BALANCE,
      "whitelist",
      30,
      null,
      now,
      "FREE_UNLIMITED",
    ),
    30,
  );
});

test("never schedules periodic whitelist resets during a trial", () => {
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.PAID_BALANCE,
      "whitelist",
      30,
      new Date("2026-10-10T12:00:00Z"),
      new Date("2026-09-11T12:00:00Z"),
      "TRIAL",
    ),
    0,
  );
});

test("keeps the configured reset for club whitelist and paid direct groups", () => {
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.CLUB_MEMBERSHIP,
      "whitelist",
      30,
      null,
    ),
    30,
  );
  assert.equal(
    resolveVpnTrafficResetDays(
      VpnProductAccessPolicy.PAID_BALANCE,
      "direct",
      30,
      null,
    ),
    30,
  );
});
