import type { InboundRouteCategory } from "@/src/lib/llm/route-contract";
import type { ObservabilityContext } from "@/src/lib/observability";
import { createObservabilityContext } from "@/src/lib/observability";

export const RESPONSE_POLICY_DECISIONS = [
  "safe_to_send",
  "needs_review",
  "block_send",
] as const;

export type ResponsePolicyDecision =
  (typeof RESPONSE_POLICY_DECISIONS)[number];

export const RESPONSE_POLICY_REASON_CODES = [
  "missing_tenant",
  "missing_body",
  "low_confidence_route",
  "pricing_unverified",
  "availability_unverified",
  "escalation_required",
] as const;

export type ResponsePolicyReasonCode =
  (typeof RESPONSE_POLICY_REASON_CODES)[number];

export const RESPONSE_POLICY_PRESENCE_STATES = [
  "present",
  "missing",
  "unknown",
] as const;

export type ResponsePolicyPresenceState =
  (typeof RESPONSE_POLICY_PRESENCE_STATES)[number];

export const RESPONSE_POLICY_FACT_VERIFICATION_STATES = [
  "not_applicable",
  "verified_deterministic",
  "verified_approved",
  "unverified",
] as const;

export type ResponsePolicyFactVerificationState =
  (typeof RESPONSE_POLICY_FACT_VERIFICATION_STATES)[number];

export const SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD = 0.75;

export interface ResponsePolicyReason {
  code: ResponsePolicyReasonCode;
  detail: string;
}

export interface EvaluateResponsePolicyInput {
  tenantState: ResponsePolicyPresenceState;
  inboundBodyState: ResponsePolicyPresenceState;
  routeCategory?: InboundRouteCategory | null;
  routeConfidence?: number | null;
  escalationSignal: boolean;
  pricingDiscussed: boolean;
  availabilityDiscussed: boolean;
  pricingVerification: ResponsePolicyFactVerificationState;
  availabilityVerification: ResponsePolicyFactVerificationState;
}

export interface ResponsePolicyEvaluation {
  decision: ResponsePolicyDecision;
  reasons: ResponsePolicyReason[];
  transportAllowed: boolean;
  routeConfidenceThreshold: number;
  evaluatedAt: string;
  observability: ObservabilityContext;
}

function isVerifiedFactState(
  state: ResponsePolicyFactVerificationState
): boolean {
  return (
    state === "verified_deterministic" || state === "verified_approved"
  );
}

function buildReason(
  code: ResponsePolicyReasonCode,
  input: EvaluateResponsePolicyInput
): ResponsePolicyReason {
  switch (code) {
    case "missing_tenant":
      return {
        code,
        detail:
          "The outbound candidate cannot be sent because no tenant context was resolved.",
      };
    case "missing_body":
      return {
        code,
        detail:
          "The outbound candidate cannot be sent because the inbound message body was empty or missing.",
      };
    case "low_confidence_route":
      return {
        code,
        detail: `Route confidence ${input.routeConfidence ?? "unknown"} is below the ${SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD.toFixed(
          2
        )} safe-send threshold.`,
      };
    case "pricing_unverified":
      return {
        code,
        detail:
          "The candidate appears to make a pricing claim without deterministic or approved verification.",
      };
    case "availability_unverified":
      return {
        code,
        detail:
          "The candidate appears to make an availability claim without deterministic or approved verification.",
      };
    case "escalation_required":
      return {
        code,
        detail:
          "The route or candidate signals escalation or uncertainty and must be reviewed before sending.",
      };
    default: {
      const exhaustiveCheck: never = code;
      return exhaustiveCheck;
    }
  }
}

function isRouteConfidenceAvailable(
  routeCategory: InboundRouteCategory | null | undefined,
  routeConfidence: number | null | undefined
): routeConfidence is number {
  return routeCategory != null && routeConfidence != null;
}

export function evaluateResponsePolicy(
  input: EvaluateResponsePolicyInput,
  options: { now?: Date; observability?: ObservabilityContext } = {}
): ResponsePolicyEvaluation {
  const reasons: ResponsePolicyReason[] = [];
  const evaluatedAt = (options.now ?? new Date()).toISOString();
  const observability = createObservabilityContext(options.observability);
  const normalizedRouteConfidence =
    typeof input.routeConfidence === "number" &&
    Number.isFinite(input.routeConfidence)
      ? input.routeConfidence
      : null;

  if (input.tenantState !== "present") {
    reasons.push(buildReason("missing_tenant", input));
  }

  if (input.inboundBodyState !== "present") {
    reasons.push(buildReason("missing_body", input));
  }

  if (
    isRouteConfidenceAvailable(input.routeCategory, normalizedRouteConfidence) &&
    normalizedRouteConfidence < SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD
  ) {
    reasons.push(buildReason("low_confidence_route", input));
  }

  if (input.escalationSignal) {
    reasons.push(buildReason("escalation_required", input));
  }

  if (
    input.pricingDiscussed &&
    !isVerifiedFactState(input.pricingVerification)
  ) {
    reasons.push(buildReason("pricing_unverified", input));
  }

  if (
    input.availabilityDiscussed &&
    !isVerifiedFactState(input.availabilityVerification)
  ) {
    reasons.push(buildReason("availability_unverified", input));
  }

  const reasonCodes = new Set(reasons.map((reason) => reason.code));
  const decision: ResponsePolicyDecision =
    reasonCodes.has("missing_tenant") || reasonCodes.has("missing_body")
      ? "block_send"
      : reasons.length > 0
        ? "needs_review"
        : "safe_to_send";

  return {
    decision,
    reasons,
    transportAllowed: decision === "safe_to_send",
    routeConfidenceThreshold: SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD,
    evaluatedAt,
    observability,
  };
}
