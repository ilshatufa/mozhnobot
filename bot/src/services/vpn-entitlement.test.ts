import assert from "node:assert/strict";
import test from "node:test";
import { VpnSubscriptionAccessOverride, VpnTrialStatus } from "@prisma/client";
import { resolveVpnEntitlement } from "./vpn-entitlement.js";

const now = new Date("2026-09-17T12:00:00Z");

test("entitlement priority is free, paid, active trial, then none", () => {
  const trial = {
    status: VpnTrialStatus.ACTIVE,
    endsAt: new Date("2026-09-24T12:00:00Z"),
    createdAt: now,
  };
  assert.equal(resolveVpnEntitlement({
    accessOverride: VpnSubscriptionAccessOverride.FREE_UNLIMITED,
    expiresAt: new Date("2026-10-17T12:00:00Z"),
    trial,
  }, now).kind, "FREE_UNLIMITED");
  assert.equal(resolveVpnEntitlement({
    accessOverride: VpnSubscriptionAccessOverride.NONE,
    expiresAt: new Date("2026-10-17T12:00:00Z"),
    trial,
  }, now).kind, "PAID");
  assert.equal(resolveVpnEntitlement({
    accessOverride: VpnSubscriptionAccessOverride.NONE,
    expiresAt: null,
    trial,
  }, now).kind, "TRIAL");
  assert.equal(resolveVpnEntitlement({
    accessOverride: VpnSubscriptionAccessOverride.NONE,
    expiresAt: null,
    trial: { ...trial, endsAt: now },
  }, now).kind, "NONE");
});

test("provisioning entitlement does not consume the seven-day trial", () => {
  const result = resolveVpnEntitlement({
    accessOverride: VpnSubscriptionAccessOverride.NONE,
    expiresAt: null,
    trial: {
      status: VpnTrialStatus.PROVISIONING,
      endsAt: null,
      createdAt: now,
    },
  }, now);
  assert.equal(result.kind, "TRIAL_PROVISIONING");
  assert.equal(result.expiresAt?.toISOString(), "2026-09-18T12:00:00.000Z");
});
