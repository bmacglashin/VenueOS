import type { OutboundMode } from "@/src/lib/config/outbound";
import type { ResponsePolicyDecision } from "@/src/services/response-policy";

export const OUTBOUND_ACTIONS = ["proceed", "queue", "block"] as const;

export type OutboundAction = (typeof OUTBOUND_ACTIONS)[number];

export const OUTBOUND_CONTROL_REASON_CODES = [
  "policy_safe_to_send",
  "policy_needs_review",
  "policy_block_send",
  "global_review_only",
  "global_disabled",
  "tenant_review_only",
  "tenant_disabled",
  "operator_approved_send",
  "operator_edited_send",
  "operator_regenerated_for_review",
] as const;

export type OutboundControlReasonCode =
  (typeof OUTBOUND_CONTROL_REASON_CODES)[number];

export interface ResolvedOutboundMode {
  globalMode: OutboundMode;
  tenantOverride: OutboundMode | null;
  mode: OutboundMode;
  source: "global" | "tenant_override";
  detail: string;
}

export interface OutboundControlReason {
  code: OutboundControlReasonCode;
  detail: string;
}

export interface OutboundDeliveryDecision {
  action: OutboundAction;
  reasons: OutboundControlReason[];
}

function buildReason(
  code: OutboundControlReasonCode
): OutboundControlReason {
  switch (code) {
    case "policy_safe_to_send":
      return {
        code,
        detail:
          "The 12A.1 response policy marked this outbound candidate safe to send.",
      };
    case "policy_needs_review":
      return {
        code,
        detail:
          "The 12A.1 response policy requires operator review before outbound send.",
      };
    case "policy_block_send":
      return {
        code,
        detail:
          "The 12A.1 response policy blocked this outbound candidate from sending.",
      };
    case "global_review_only":
      return {
        code,
        detail:
          "Global outbound mode is review_only, so otherwise-safe candidates must stay in queue.",
      };
    case "global_disabled":
      return {
        code,
        detail:
          "Global outbound mode is disabled, so outbound transport is blocked for every tenant.",
      };
    case "tenant_review_only":
      return {
        code,
        detail:
          "The tenant override forces review_only, so otherwise-safe candidates stay in queue.",
      };
    case "tenant_disabled":
      return {
        code,
        detail:
          "The tenant override disables outbound sending for this tenant.",
      };
    case "operator_approved_send":
      return {
        code,
        detail:
          "A Mission Control operator approved the queued draft and moved it onto the shared transport path.",
      };
    case "operator_edited_send":
      return {
        code,
        detail:
          "A Mission Control operator edited the draft and sent the revised version through the shared transport path.",
      };
    case "operator_regenerated_for_review":
      return {
        code,
        detail:
          "A Mission Control operator regenerated the draft, which intentionally created a fresh review candidate instead of sending immediately.",
      };
    default: {
      const exhaustiveCheck: never = code;
      return exhaustiveCheck;
    }
  }
}

export function resolveOutboundMode(input: {
  globalMode: OutboundMode;
  tenantOverride?: OutboundMode | null;
}): ResolvedOutboundMode {
  const tenantOverride = input.tenantOverride ?? null;

  if (input.globalMode === "disabled") {
    return {
      globalMode: input.globalMode,
      tenantOverride,
      mode: "disabled",
      source: "global",
      detail:
        "Global outbound mode is disabled. Tenant overrides are ignored until outbound is re-enabled globally.",
    };
  }

  if (input.globalMode === "review_only") {
    return {
      globalMode: input.globalMode,
      tenantOverride,
      mode: "review_only",
      source: "global",
      detail:
        "Global outbound mode is review_only. Tenant overrides are ignored until global mode returns to enabled.",
    };
  }

  if (tenantOverride != null) {
    return {
      globalMode: input.globalMode,
      tenantOverride,
      mode: tenantOverride,
      source: "tenant_override",
      detail: `Tenant override resolved outbound mode to ${tenantOverride}.`,
    };
  }

  return {
    globalMode: input.globalMode,
    tenantOverride,
    mode: "enabled",
    source: "global",
    detail: "Global outbound mode is enabled with no tenant override applied.",
  };
}

export function determineOutboundDelivery(input: {
  policyDecision: ResponsePolicyDecision;
  resolvedMode: ResolvedOutboundMode;
}): OutboundDeliveryDecision {
  const reasons: OutboundControlReason[] = [];

  if (input.resolvedMode.mode === "disabled") {
    reasons.push(
      buildReason(
        input.resolvedMode.source === "tenant_override"
          ? "tenant_disabled"
          : "global_disabled"
      )
    );

    if (input.policyDecision === "needs_review") {
      reasons.push(buildReason("policy_needs_review"));
    } else if (input.policyDecision === "block_send") {
      reasons.push(buildReason("policy_block_send"));
    }

    return {
      action: "block",
      reasons,
    };
  }

  if (input.policyDecision === "block_send") {
    reasons.push(buildReason("policy_block_send"));

    return {
      action: "block",
      reasons,
    };
  }

  if (input.resolvedMode.mode === "review_only") {
    reasons.push(
      buildReason(
        input.resolvedMode.source === "tenant_override"
          ? "tenant_review_only"
          : "global_review_only"
      )
    );

    if (input.policyDecision === "needs_review") {
      reasons.push(buildReason("policy_needs_review"));
    }

    return {
      action: "queue",
      reasons,
    };
  }

  if (input.policyDecision === "needs_review") {
    reasons.push(buildReason("policy_needs_review"));

    return {
      action: "queue",
      reasons,
    };
  }

  reasons.push(buildReason("policy_safe_to_send"));

  return {
    action: "proceed",
    reasons,
  };
}
