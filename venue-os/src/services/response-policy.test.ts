import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD,
  evaluateResponsePolicy,
  type EvaluateResponsePolicyInput,
} from "./response-policy";

function buildPolicyInput(
  overrides: Partial<EvaluateResponsePolicyInput> = {}
): EvaluateResponsePolicyInput {
  return {
    tenantState: "present",
    inboundBodyState: "present",
    routeCategory: "general_hospitality",
    routeConfidence: 0.92,
    escalationSignal: false,
    pricingDiscussed: false,
    availabilityDiscussed: false,
    pricingVerification: "not_applicable",
    availabilityVerification: "not_applicable",
    ...overrides,
  };
}

describe("evaluateResponsePolicy", () => {
  it("returns safe_to_send for a grounded low-risk candidate", () => {
    const result = evaluateResponsePolicy(buildPolicyInput());

    assert.equal(result.decision, "safe_to_send");
    assert.equal(result.transportAllowed, true);
    assert.deepEqual(result.reasons, []);
  });

  it("blocks send when tenant context is missing", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        tenantState: "missing",
      })
    );

    assert.equal(result.decision, "block_send");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "missing_tenant",
    ]);
  });

  it("blocks send when the inbound body is missing", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        inboundBodyState: "missing",
        routeCategory: null,
        routeConfidence: null,
      })
    );

    assert.equal(result.decision, "block_send");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "missing_body",
    ]);
  });

  it("queues low-confidence routes for review", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        routeConfidence: SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD - 0.01,
      })
    );

    assert.equal(result.decision, "needs_review");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "low_confidence_route",
    ]);
  });

  it("queues escalated routes for review", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        escalationSignal: true,
      })
    );

    assert.equal(result.decision, "needs_review");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "escalation_required",
    ]);
  });

  it("queues unverified pricing claims for review", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        pricingDiscussed: true,
        pricingVerification: "unverified",
      })
    );

    assert.equal(result.decision, "needs_review");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "pricing_unverified",
    ]);
  });

  it("queues unverified availability claims for review", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        availabilityDiscussed: true,
        availabilityVerification: "unverified",
      })
    );

    assert.equal(result.decision, "needs_review");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "availability_unverified",
    ]);
  });

  it("allows verified pricing and availability facts to pass", () => {
    const result = evaluateResponsePolicy(
      buildPolicyInput({
        pricingDiscussed: true,
        availabilityDiscussed: true,
        pricingVerification: "verified_approved",
        availabilityVerification: "verified_deterministic",
      })
    );

    assert.equal(result.decision, "safe_to_send");
    assert.equal(result.transportAllowed, true);
    assert.deepEqual(result.reasons, []);
  });
});
