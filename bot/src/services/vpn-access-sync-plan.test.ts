import assert from "node:assert/strict";
import test from "node:test";
import {
  ClubMembershipStatus,
  Role,
  VpnProductAccessPolicy,
  VpnSubscriptionInboundStatus,
  VpnSubscriptionStatus,
} from "@prisma/client";
import {
  buildVpnAccessSyncPlan,
  type VpnAccessSyncPlanInput,
} from "./vpn-access-sync-plan.js";

function input(overrides: Partial<VpnAccessSyncPlanInput> = {}): VpnAccessSyncPlanInput {
  const base: VpnAccessSyncPlanInput = {
    now: new Date("2026-09-10T00:00:00Z"),
    paidAccess: false,
    user: {
      role: Role.USER,
      clubStatus: ClubMembershipStatus.MEMBER,
      vpnBlocked: false,
      isBanned: false,
    },
    product: {
      isActive: true,
      accessPolicy: VpnProductAccessPolicy.CLUB_MEMBERSHIP,
      revision: 2,
      inbounds: [
        { inboundId: 10, isRequired: true, inbound: { isActive: true } },
        { inboundId: 11, isRequired: false, inbound: { isActive: true } },
      ],
    },
    subscription: {
      status: VpnSubscriptionStatus.ACTIVE,
      expiresAt: null,
      appliedRevision: 1,
      inboundStates: [],
    },
  };

  return {
    ...base,
    ...overrides,
    user: { ...base.user, ...overrides.user },
    product: { ...base.product, ...overrides.product },
    subscription: { ...base.subscription, ...overrides.subscription },
  };
}

test("plans every active inbound for an eligible club member", () => {
  const plan = buildVpnAccessSyncPlan(input());

  assert.equal(plan.eligible, true);
  assert.equal(plan.reason, "ELIGIBLE");
  assert.deepEqual(plan.actions, [
    { kind: "ENSURE_ENABLED", inboundId: 10, isRequired: true },
    { kind: "ENSURE_ENABLED", inboundId: 11, isRequired: false },
  ]);
});

test("plans reversible disable when a member has left the club", () => {
  const plan = buildVpnAccessSyncPlan(input({
    user: { clubStatus: ClubMembershipStatus.LEFT } as VpnAccessSyncPlanInput["user"],
    subscription: {
      inboundStates: [
        { inboundId: 10, status: VpnSubscriptionInboundStatus.ACTIVE },
        { inboundId: 11, status: VpnSubscriptionInboundStatus.ACTIVE },
      ],
    } as VpnAccessSyncPlanInput["subscription"],
  }));

  assert.equal(plan.eligible, false);
  assert.equal(plan.reason, "CLUB_MEMBERSHIP_REQUIRED");
  assert.deepEqual(plan.actions.map((action) => action.kind), ["DISABLE", "DISABLE"]);
});

test("manual router access does not depend on club membership", () => {
  const plan = buildVpnAccessSyncPlan(input({
    user: { clubStatus: ClubMembershipStatus.REMOVED } as VpnAccessSyncPlanInput["user"],
    product: { accessPolicy: VpnProductAccessPolicy.MANUAL } as VpnAccessSyncPlanInput["product"],
  }));

  assert.equal(plan.eligible, true);
});

test("paid product fails closed without a positive entitlement", () => {
  const plan = buildVpnAccessSyncPlan(input({
    product: { accessPolicy: VpnProductAccessPolicy.PAID_BALANCE } as VpnAccessSyncPlanInput["product"],
  }));

  assert.equal(plan.eligible, false);
  assert.equal(plan.reason, "PAID_ACCESS_REQUIRED");
});

test("global block overrides every access policy", () => {
  const plan = buildVpnAccessSyncPlan(input({
    user: { vpnBlocked: true } as VpnAccessSyncPlanInput["user"],
    product: { accessPolicy: VpnProductAccessPolicy.MANUAL } as VpnAccessSyncPlanInput["product"],
  }));

  assert.equal(plan.eligible, false);
  assert.equal(plan.reason, "USER_BLOCKED");
});

test("removes an inbound that is no longer part of the product", () => {
  const plan = buildVpnAccessSyncPlan(input({
    product: {
      inbounds: [{ inboundId: 10, isRequired: true, inbound: { isActive: true } }],
    } as VpnAccessSyncPlanInput["product"],
    subscription: {
      appliedRevision: 2,
      inboundStates: [
        { inboundId: 10, status: VpnSubscriptionInboundStatus.ACTIVE },
        { inboundId: 11, status: VpnSubscriptionInboundStatus.ACTIVE },
      ],
    } as VpnAccessSyncPlanInput["subscription"],
  }));

  assert.deepEqual(plan.actions, [
    { kind: "DISABLE", inboundId: 11, isRequired: false },
  ]);
});
