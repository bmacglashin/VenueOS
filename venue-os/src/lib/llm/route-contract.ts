import { z } from "zod";

export const INBOUND_ROUTE_CATEGORIES = [
  "general_hospitality",
  "high_ticket_event",
  "booking_request",
  "unknown_needs_review",
] as const;

export type InboundRouteCategory = (typeof INBOUND_ROUTE_CATEGORIES)[number];

export const ROUTE_INBOUND_REPLY_SOURCES = [
  "venue_model",
  "premium_holding",
] as const;

export type RouteInboundReplySource =
  (typeof ROUTE_INBOUND_REPLY_SOURCES)[number];

export const inboundRouteClassificationSchema = z.object({
  category: z.enum(INBOUND_ROUTE_CATEGORIES),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.boolean(),
  rationale: z.string().trim().min(1),
});

export type InboundRouteClassification = z.infer<
  typeof inboundRouteClassificationSchema
>;
