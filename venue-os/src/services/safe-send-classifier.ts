import type { InboundRouteClassification } from "@/src/lib/llm/route-contract";
import type { ResponsePolicyFactVerificationState } from "@/src/services/response-policy";

const PRICING_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d{1,2})?/i,
  /\b(?:usd|dollars?)\b/i,
  /\b(?:costs?|rates?|fees?|quote|quoted|minimum spend)\b/i,
  /\b(?:pricing|price)\s+(?:starts?|begins?)\b/i,
] as const;

const AVAILABILITY_PATTERNS = [
  /\bavailable\b/i,
  /\bavailability\b/i,
  /\bopenings?\b/i,
  /\bopen slots?\b/i,
  /\bsold out\b/i,
  /\bfully booked\b/i,
  /\bcan accommodate\b/i,
  /\bspots? left\b/i,
] as const;

export interface SafeSendClassifierInput {
  candidateResponse: string;
  route: Pick<
    InboundRouteClassification,
    "category" | "confidence" | "requiresHumanReview"
  >;
  pricingVerification?: ResponsePolicyFactVerificationState;
  availabilityVerification?: ResponsePolicyFactVerificationState;
}

export interface SafeSendClassifierResult {
  escalationSignal: boolean;
  pricingDiscussed: boolean;
  availabilityDiscussed: boolean;
  pricingVerification: ResponsePolicyFactVerificationState;
  availabilityVerification: ResponsePolicyFactVerificationState;
}

function normalizeCandidateResponse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textMatchesAnyPattern(
  value: string,
  patterns: readonly RegExp[]
): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeVerificationState(
  state: ResponsePolicyFactVerificationState | undefined,
  discussed: boolean
): ResponsePolicyFactVerificationState {
  if (!discussed) {
    return "not_applicable";
  }

  if (
    state === "verified_deterministic" ||
    state === "verified_approved" ||
    state === "unverified"
  ) {
    return state;
  }

  return "unverified";
}

export function classifyCandidateResponseForSafeSend(
  input: SafeSendClassifierInput
): SafeSendClassifierResult {
  const candidateResponse = normalizeCandidateResponse(input.candidateResponse);
  const pricingDiscussed = textMatchesAnyPattern(
    candidateResponse,
    PRICING_PATTERNS
  );
  const availabilityDiscussed = textMatchesAnyPattern(
    candidateResponse,
    AVAILABILITY_PATTERNS
  );

  return {
    escalationSignal:
      input.route.requiresHumanReview ||
      input.route.category === "unknown_needs_review",
    pricingDiscussed,
    availabilityDiscussed,
    pricingVerification: normalizeVerificationState(
      input.pricingVerification,
      pricingDiscussed
    ),
    availabilityVerification: normalizeVerificationState(
      input.availabilityVerification,
      availabilityDiscussed
    ),
  };
}
