import { SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD } from "@/src/services/response-policy";

export const REVIEW_QUEUE_CONFIDENCE_BANDS = [
  "low",
  "medium",
  "high",
  "unknown",
] as const;

export type ReviewQueueConfidenceBand =
  (typeof REVIEW_QUEUE_CONFIDENCE_BANDS)[number];

export interface ReviewQueueFilters {
  tenantId?: string;
  route?: string;
  status?: string;
  confidenceBand?: ReviewQueueConfidenceBand;
}

export interface ReviewQueuePolicyReason {
  code: string;
  detail: string;
}

export interface ReviewQueueItem {
  id: string;
  conversationId: string;
  tenantId: string;
  tenantName: string;
  status: string;
  inboundExcerpt: string | null;
  route: string | null;
  confidence: number | null;
  confidenceBand: ReviewQueueConfidenceBand;
  policyDecision: string | null;
  policyReasons: ReviewQueuePolicyReason[];
  createdAt: string;
}

export function getReviewQueueConfidenceBand(
  confidence: number | null,
  options: { reviewThreshold?: number; highThreshold?: number } = {}
): ReviewQueueConfidenceBand {
  if (confidence == null || !Number.isFinite(confidence)) {
    return "unknown";
  }

  const reviewThreshold =
    options.reviewThreshold ?? SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD;
  const highThreshold = options.highThreshold ?? 0.9;

  if (confidence < reviewThreshold) {
    return "low";
  }

  if (confidence >= highThreshold) {
    return "high";
  }

  return "medium";
}

export function filterReviewQueueItems(
  items: readonly ReviewQueueItem[],
  filters: ReviewQueueFilters
): ReviewQueueItem[] {
  return items.filter((item) => {
    if (filters.tenantId != null && item.tenantId !== filters.tenantId) {
      return false;
    }

    if (filters.route != null && item.route !== filters.route) {
      return false;
    }

    if (filters.status != null && item.status !== filters.status) {
      return false;
    }

    if (
      filters.confidenceBand != null &&
      item.confidenceBand !== filters.confidenceBand
    ) {
      return false;
    }

    return true;
  });
}
