import "server-only";

import {
  createObservabilityContext,
  type ObservabilityContext,
  ValidationError,
} from "@/src/lib/observability";
import { getVenueKnowledge } from "./knowledge";
import {
  inboundRouteClassificationSchema,
  type InboundRouteClassification,
  type InboundRouteCategory,
  type RouteInboundReplySource,
} from "./route-contract";
import {
  runVenueModel,
  runVenueStructuredOutput,
  type VenueMessageRole,
  type VenueModelMetadata,
  type VenueRecentMessage,
  type VenueStructuredOutputMetadata,
} from "../../services/ai";

export {
  INBOUND_ROUTE_CATEGORIES,
  inboundRouteClassificationSchema,
  ROUTE_INBOUND_REPLY_SOURCES,
} from "./route-contract";
export type {
  InboundRouteClassification,
  InboundRouteCategory,
  RouteInboundReplySource,
} from "./route-contract";

export interface RouteInboundVenueContext {
  id?: string;
  slug?: string;
  venueName: string;
}

export interface RouteInboundConversationContext {
  id?: string;
  recentMessages?: readonly VenueRecentMessage[];
}

export interface RouteInboundMessageInput {
  message: string;
  venue: RouteInboundVenueContext;
  conversation: RouteInboundConversationContext;
  observability?: ObservabilityContext;
  inboundMessageId?: string;
  receivedAt?: Date | string;
}

export interface RouteInboundMessagePersistenceMetadata {
  venueId?: string;
  venueName: string;
  conversationId?: string;
  inboundMessageId?: string;
  receivedAt?: string;
  routedAt: string;
  routeCategory: InboundRouteCategory;
  routeConfidence: number;
  requiresHumanReview: boolean;
  rationale: string;
  replySource: RouteInboundReplySource;
}

export interface RouteInboundMessageMetadata {
  observability: ObservabilityContext;
  knowledgeSource: "getVenueKnowledge";
  knowledgeContextCharacters: number;
  recentMessageCount: number;
  replySource: RouteInboundReplySource;
  classificationMetadata: VenueStructuredOutputMetadata;
  responseMetadata: VenueModelMetadata | null;
  persistence: RouteInboundMessagePersistenceMetadata;
}

export interface RouteInboundMessageResult {
  classification: InboundRouteClassification;
  aiReply: string;
  metadata: RouteInboundMessageMetadata;
}

const ROUTING_SCHEMA_NAME = "InboundMessageRoutingClassification";
const ROUTING_SCHEMA_DESCRIPTION =
  "Structured routing decision for inbound venue messages.";
const ROUTING_PURPOSE = "inbound_message_routing";

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} is required.`);
  }

  return trimmed;
}

function toTrimmedText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "No content provided.";
}

function normalizeTimestamp(timestamp?: Date | string): string | undefined {
  if (timestamp == null) {
    return undefined;
  }

  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }

  const trimmed = timestamp.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatRole(role: VenueMessageRole): string {
  switch (role) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "user":
    default:
      return "Guest";
  }
}

function formatTimestamp(timestamp?: Date | string): string {
  const normalized = normalizeTimestamp(timestamp);
  return normalized != null ? ` @ ${normalized}` : "";
}

function indentBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatRecentMessages(recentMessages: readonly VenueRecentMessage[]): string {
  if (recentMessages.length === 0) {
    return "No recent messages provided.";
  }

  return recentMessages
    .map((recentMessage, index) => {
      const heading = `${index + 1}. ${formatRole(recentMessage.role)}${formatTimestamp(
        recentMessage.timestamp
      )}`;

      return `${heading}\n${indentBlock(toTrimmedText(recentMessage.content))}`;
    })
    .join("\n\n");
}

function buildRoutingSystemPrompt(venueName: string): string {
  return [
    "You are the Venue OS inbound routing classifier.",
    `Classify the latest inbound message for ${venueName}.`,
    "Use the venue knowledge and recent conversation history as grounding context.",
    "Choose exactly one category from the schema.",
    "Category guide:",
    "- general_hospitality: standard venue, hospitality, amenity, logistics, policy, or guest support questions.",
    "- high_ticket_event: premium events, private buyouts, weddings, corporate events, VIP coordination, or large-budget planning.",
    "- booking_request: direct booking or reservation intent that can move into scheduling, availability, or next-step collection.",
    "- unknown_needs_review: ambiguous, unsupported, risky, or under-specified requests where the system should not pretend certainty.",
    "Set requiresHumanReview to true whenever a human should inspect the conversation before relying on the response.",
    "If category is unknown_needs_review, requiresHumanReview must be true.",
    "Keep the rationale concise and grounded in the supplied context.",
    "Confidence must be a number between 0 and 1.",
  ].join("\n");
}

function buildRoutingPrompt(input: {
  venueName: string;
  message: string;
  knowledge: string;
  recentMessages: readonly VenueRecentMessage[];
}): string {
  return [
    `Venue name: ${input.venueName}`,
    "",
    "Venue knowledge:",
    input.knowledge,
    "",
    "Recent messages:",
    formatRecentMessages(input.recentMessages),
    "",
    "Latest inbound message:",
    input.message,
  ].join("\n");
}

function normalizeClassification(
  classification: InboundRouteClassification
): InboundRouteClassification {
  return inboundRouteClassificationSchema.parse({
    ...classification,
    rationale: classification.rationale.trim(),
    requiresHumanReview:
      classification.category === "unknown_needs_review"
        ? true
        : classification.requiresHumanReview,
  });
}

function buildPremiumHoldingReply(venueName: string): string {
  return [
    `Thank you for reaching out to ${venueName}.`,
    "To make sure we give you the most accurate guidance, a member of our team is reviewing this personally and will follow up shortly.",
  ].join(" ");
}

function buildRoutingMetadata(input: {
  venue: RouteInboundVenueContext;
  conversation: RouteInboundConversationContext;
  observability?: ObservabilityContext;
  inboundMessageId?: string;
  receivedAt?: Date | string;
  classification: InboundRouteClassification;
  knowledge: string;
  recentMessageCount: number;
  replySource: RouteInboundReplySource;
  routedAt: string;
  classificationMetadata: VenueStructuredOutputMetadata;
  responseMetadata: VenueModelMetadata | null;
}): RouteInboundMessageMetadata {
  return {
    observability: createObservabilityContext(input.observability),
    knowledgeSource: "getVenueKnowledge",
    knowledgeContextCharacters: input.knowledge.length,
    recentMessageCount: input.recentMessageCount,
    replySource: input.replySource,
    classificationMetadata: input.classificationMetadata,
    responseMetadata: input.responseMetadata,
    persistence: {
      venueId: input.venue.id,
      venueName: input.venue.venueName,
      conversationId: input.conversation.id,
      inboundMessageId: input.inboundMessageId,
      receivedAt: normalizeTimestamp(input.receivedAt),
      routedAt: input.routedAt,
      routeCategory: input.classification.category,
      routeConfidence: input.classification.confidence,
      requiresHumanReview: input.classification.requiresHumanReview,
      rationale: input.classification.rationale,
      replySource: input.replySource,
    },
  };
}

export async function routeInboundMessage(
  input: RouteInboundMessageInput
): Promise<RouteInboundMessageResult> {
  const venueName = requireNonEmpty(input.venue.venueName, "Venue name");
  const message = requireNonEmpty(input.message, "Inbound message");
  const recentMessages = input.conversation.recentMessages ?? [];
  const knowledge = await getVenueKnowledge({
    tenantId: input.venue.id,
    tenantSlug: input.venue.slug,
  });

  const classificationResult = await runVenueStructuredOutput({
    system: buildRoutingSystemPrompt(venueName),
    prompt: buildRoutingPrompt({
      venueName,
      message,
      knowledge,
      recentMessages,
    }),
    schema: inboundRouteClassificationSchema,
    schemaName: ROUTING_SCHEMA_NAME,
    schemaDescription: ROUTING_SCHEMA_DESCRIPTION,
    purpose: ROUTING_PURPOSE,
  });

  const classification = normalizeClassification(classificationResult.object);
  const routedAt = new Date().toISOString();

  if (classification.category === "unknown_needs_review") {
    const aiReply = buildPremiumHoldingReply(venueName);

    return {
      classification,
      aiReply,
      metadata: buildRoutingMetadata({
        venue: { ...input.venue, venueName },
        conversation: input.conversation,
        observability: input.observability,
        inboundMessageId: input.inboundMessageId,
        receivedAt: input.receivedAt,
        classification,
        knowledge,
        recentMessageCount: recentMessages.length,
        replySource: "premium_holding",
        routedAt,
        classificationMetadata: classificationResult.metadata,
        responseMetadata: null,
      }),
    };
  }

  const response = await runVenueModel({
    message,
    venueName,
    knowledgeContext: knowledge,
    recentMessages,
    mode: classification.category,
  });

  return {
    classification,
    aiReply: response.replyText,
    metadata: buildRoutingMetadata({
      venue: { ...input.venue, venueName },
      conversation: input.conversation,
      observability: input.observability,
      inboundMessageId: input.inboundMessageId,
      receivedAt: input.receivedAt,
      classification,
      knowledge,
      recentMessageCount: recentMessages.length,
      replySource: "venue_model",
      routedAt,
      classificationMetadata: classificationResult.metadata,
      responseMetadata: response.metadata,
    }),
  };
}
