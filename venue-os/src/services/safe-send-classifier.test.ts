import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyCandidateResponseForSafeSend } from "./safe-send-classifier";

describe("classifyCandidateResponseForSafeSend", () => {
  it("detects availability language and preserves the provided verification state", () => {
    const result = classifyCandidateResponseForSafeSend({
      candidateResponse:
        "We still have Saturday availability in October for private events.",
      route: {
        category: "general_hospitality",
        confidence: 0.91,
        requiresHumanReview: false,
      },
      availabilityVerification: "unverified",
    });

    assert.equal(result.availabilityDiscussed, true);
    assert.equal(result.availabilityVerification, "unverified");
  });
});
