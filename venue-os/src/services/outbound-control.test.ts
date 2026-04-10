import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  determineOutboundDelivery,
  resolveOutboundMode,
} from "./outbound-control";

describe("resolveOutboundMode", () => {
  it("lets global disabled beat every tenant override", () => {
    const result = resolveOutboundMode({
      globalMode: "disabled",
      tenantOverride: "enabled",
    });

    assert.equal(result.mode, "disabled");
    assert.equal(result.source, "global");
  });

  it("lets global review_only beat a tenant enabled override", () => {
    const result = resolveOutboundMode({
      globalMode: "review_only",
      tenantOverride: "enabled",
    });

    assert.equal(result.mode, "review_only");
    assert.equal(result.source, "global");
  });

  it("applies the tenant override only while global mode is enabled", () => {
    const result = resolveOutboundMode({
      globalMode: "enabled",
      tenantOverride: "disabled",
    });

    assert.equal(result.mode, "disabled");
    assert.equal(result.source, "tenant_override");
  });
});

describe("determineOutboundDelivery", () => {
  it("proceeds only when outbound mode is enabled and policy is safe_to_send", () => {
    const result = determineOutboundDelivery({
      policyDecision: "safe_to_send",
      resolvedMode: resolveOutboundMode({
        globalMode: "enabled",
      }),
    });

    assert.equal(result.action, "proceed");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "policy_safe_to_send",
    ]);
  });

  it("queues otherwise-safe replies when resolved mode is review_only", () => {
    const result = determineOutboundDelivery({
      policyDecision: "safe_to_send",
      resolvedMode: resolveOutboundMode({
        globalMode: "review_only",
      }),
    });

    assert.equal(result.action, "queue");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "global_review_only",
    ]);
  });

  it("blocks otherwise-safe replies when resolved mode is disabled", () => {
    const result = determineOutboundDelivery({
      policyDecision: "safe_to_send",
      resolvedMode: resolveOutboundMode({
        globalMode: "disabled",
      }),
    });

    assert.equal(result.action, "block");
    assert.deepEqual(result.reasons.map((reason) => reason.code), [
      "global_disabled",
    ]);
  });
});
