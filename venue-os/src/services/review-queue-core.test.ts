import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterReviewQueueItems,
  getReviewQueueConfidenceBand,
  type ReviewQueueItem,
} from "./review-queue-core";

function buildQueueItem(
  overrides: Partial<ReviewQueueItem> = {}
): ReviewQueueItem {
  return {
    id: "review-item-1",
    conversationId: "conversation-1",
    tenantId: "tenant-a",
    tenantName: "Tenant A",
    status: "open",
    inboundExcerpt: "Customer asked about booking options.",
    route: "booking_request",
    confidence: 0.91,
    confidenceBand: "high",
    policyDecision: "needs_review",
    policyReasons: [
      {
        code: "pricing_unverified",
        detail: "Pricing was mentioned without approved verification.",
      },
    ],
    createdAt: "2026-04-10T15:00:00.000Z",
    ...overrides,
  };
}

describe("getReviewQueueConfidenceBand", () => {
  it("maps confidence values into operational bands", () => {
    assert.equal(getReviewQueueConfidenceBand(0.6), "low");
    assert.equal(getReviewQueueConfidenceBand(0.8), "medium");
    assert.equal(getReviewQueueConfidenceBand(0.95), "high");
    assert.equal(getReviewQueueConfidenceBand(null), "unknown");
  });
});

describe("filterReviewQueueItems", () => {
  const items = [
    buildQueueItem(),
    buildQueueItem({
      id: "review-item-2",
      conversationId: "conversation-2",
      tenantId: "tenant-b",
      tenantName: "Tenant B",
      route: "unknown_needs_review",
      confidence: 0.62,
      confidenceBand: "low",
      status: "pending",
    }),
    buildQueueItem({
      id: "review-item-3",
      conversationId: "conversation-3",
      tenantId: "tenant-a",
      tenantName: "Tenant A",
      route: "general_hospitality",
      confidence: null,
      confidenceBand: "unknown",
      status: "closed",
    }),
  ];

  it("filters the queue by tenant", () => {
    const filtered = filterReviewQueueItems(items, {
      tenantId: "tenant-a",
    });

    assert.deepEqual(
      filtered.map((item) => item.id),
      ["review-item-1", "review-item-3"]
    );
  });

  it("filters the queue by route and conversation status", () => {
    const filtered = filterReviewQueueItems(items, {
      route: "unknown_needs_review",
      status: "pending",
    });

    assert.deepEqual(filtered.map((item) => item.id), ["review-item-2"]);
  });

  it("filters the queue by confidence band", () => {
    const filtered = filterReviewQueueItems(items, {
      confidenceBand: "unknown",
    });

    assert.deepEqual(filtered.map((item) => item.id), ["review-item-3"]);
  });
});
