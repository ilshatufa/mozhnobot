import {
  ClubMembershipStatus,
  Role,
  VpnProductAccessPolicy,
  VpnSubscriptionAccessOverride,
  VpnSubscriptionInboundStatus,
  VpnSubscriptionStatus,
} from "@prisma/client";

export type VpnAccessDecisionReason =
  | "ELIGIBLE"
  | "PRODUCT_INACTIVE"
  | "SUBSCRIPTION_DISABLED"
  | "SUBSCRIPTION_EXPIRED"
  | "USER_BLOCKED"
  | "USER_BANNED"
  | "FREE_UNLIMITED"
  | "CLUB_MEMBERSHIP_REQUIRED"
  | "PAID_ACCESS_REQUIRED";

export interface VpnAccessSyncPlanInput {
  now: Date;
  paidAccess: boolean;
  user: {
    role: Role;
    clubStatus: ClubMembershipStatus;
    vpnBlocked: boolean;
    isBanned: boolean;
  };
  product: {
    isActive: boolean;
    accessPolicy: VpnProductAccessPolicy;
    revision: number;
    inbounds: Array<{
      inboundId: number;
      isRequired: boolean;
      inbound: { isActive: boolean };
    }>;
  };
  subscription: {
    status: VpnSubscriptionStatus;
    accessOverride: VpnSubscriptionAccessOverride;
    expiresAt: Date | null;
    appliedRevision: number;
    inboundStates: Array<{
      inboundId: number;
      status: VpnSubscriptionInboundStatus;
    }>;
  };
}

export interface VpnAccessSyncAction {
  kind: "ENSURE_ENABLED" | "DISABLE";
  inboundId: number;
  isRequired: boolean;
}

export interface VpnAccessSyncPlan {
  eligible: boolean;
  reason: VpnAccessDecisionReason;
  targetRevision: number;
  actions: VpnAccessSyncAction[];
  fullyApplied: boolean;
}

function accessDecision(input: VpnAccessSyncPlanInput): {
  eligible: boolean;
  reason: VpnAccessDecisionReason;
} {
  if (!input.product.isActive) return { eligible: false, reason: "PRODUCT_INACTIVE" };
  if (input.subscription.status !== VpnSubscriptionStatus.ACTIVE) {
    return { eligible: false, reason: "SUBSCRIPTION_DISABLED" };
  }
  if (input.subscription.expiresAt && input.subscription.expiresAt <= input.now) {
    return { eligible: false, reason: "SUBSCRIPTION_EXPIRED" };
  }
  if (input.user.vpnBlocked) return { eligible: false, reason: "USER_BLOCKED" };
  if (input.user.isBanned) return { eligible: false, reason: "USER_BANNED" };
  if (input.subscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED) {
    return { eligible: true, reason: "FREE_UNLIMITED" };
  }

  switch (input.product.accessPolicy) {
    case VpnProductAccessPolicy.CLUB_MEMBERSHIP:
      return input.user.role === Role.ADMIN || input.user.clubStatus === ClubMembershipStatus.MEMBER
        ? { eligible: true, reason: "ELIGIBLE" }
        : { eligible: false, reason: "CLUB_MEMBERSHIP_REQUIRED" };
    case VpnProductAccessPolicy.PAID_BALANCE:
      return input.paidAccess
        ? { eligible: true, reason: "ELIGIBLE" }
        : { eligible: false, reason: "PAID_ACCESS_REQUIRED" };
    case VpnProductAccessPolicy.MANUAL:
      return { eligible: true, reason: "ELIGIBLE" };
  }
}

export function buildVpnAccessSyncPlan(input: VpnAccessSyncPlanInput): VpnAccessSyncPlan {
  const decision = accessDecision(input);
  const desiredInbounds = new Map(
    input.product.inbounds
      .filter((item) => item.inbound.isActive)
      .map((item) => [item.inboundId, item.isRequired]),
  );
  const currentStates = new Map(input.subscription.inboundStates.map((item) => [item.inboundId, item.status]));
  const actions: VpnAccessSyncAction[] = [];

  if (decision.eligible) {
    for (const [inboundId, isRequired] of desiredInbounds) {
      if (currentStates.get(inboundId) !== VpnSubscriptionInboundStatus.ACTIVE) {
        actions.push({ kind: "ENSURE_ENABLED", inboundId, isRequired });
      }
    }
  }

  for (const state of input.subscription.inboundStates) {
    if (
      (!decision.eligible || !desiredInbounds.has(state.inboundId)) &&
      state.status !== VpnSubscriptionInboundStatus.DISABLED
    ) {
      actions.push({
        kind: "DISABLE",
        inboundId: state.inboundId,
        isRequired: desiredInbounds.get(state.inboundId) ?? false,
      });
    }
  }

  return {
    ...decision,
    targetRevision: input.product.revision,
    actions,
    fullyApplied:
      actions.length === 0 && input.subscription.appliedRevision === input.product.revision,
  };
}
