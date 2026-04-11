import { z } from "zod";

import type {
  InboundRouteClassification,
  RouteInboundMessageInput,
  RouteInboundMessageMetadata,
  RouteInboundMessageResult,
} from "@/src/lib/llm/router";
import type { Database, Json } from "@/src/lib/db/supabase";
import type { VenueMessageRole, VenueRecentMessage } from "@/src/services/ai";
import type { InsertAuditLogInput } from "@/src/services/audit-logs";
import type {
  FetchRecentMessagesInput,
  InsertMessageInput,
} from "@/src/services/messages";
import type {
  EvaluateResponsePolicyInput,
  ResponsePolicyEvaluation,
} from "@/src/services/response-policy";
import type {
  OutboundDeliveryDecision,
  ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import { determineOutboundDelivery } from "@/src/services/outbound-control";
import type {
  DispatchOutboundTransportInput,
  OutboundTransportDispatchResult,
} from "@/src/services/outbound-transport";
import type {
  SafeSendClassifierInput,
  SafeSendClassifierResult,
} from "@/src/services/safe-send-classifier";
import {
  AI_DRAFT_SOURCE,
  buildDraftVersionMetadata,
} from "@/src/services/draft-history";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

const SESSION_MEMORY_LIMIT = 5;
const TURN_PERSISTED_EVENT = "conversation_turn.persisted";
const TURN_FAILED_EVENT = "conversation_turn.failed";
const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const conversationTurnRequestSchema = z.object({
  tenantId: z.string().uuid(),
  venue: z.object({
    id: z.string().uuid().optional(),
    venueName: z.string().trim().min(1),
  }),
  conversation: z.object({
    id: z.string().uuid().optional(),
    ghlContactId: z.string().trim().min(1).nullable().optional(),
    ghlConversationId: z.string().trim().min(1).nullable().optional(),
    status: z.string().trim().min(1).optional(),
  }),
  inbound: z.object({
    content: z.string().trim().min(1),
    source: z.string().trim().min(1),
    role: z.string().trim().min(1).optional(),
    ghlMessageId: z.string().trim().min(1).nullable().optional(),
    receivedAt: z.string().trim().min(1).optional(),
    rawPayload: jsonValueSchema.optional(),
    metadata: jsonObjectSchema.optional(),
  }),
});

export type ConversationTurnRequest = z.infer<
  typeof conversationTurnRequestSchema
>;

export interface OrchestrateConversationTurnResult {
  conversation: Conversation;
  recentMessages: Message[];
  inboundMessage: Message;
  aiDraftMessage: Message;
  classification: InboundRouteClassification;
  aiReply: string;
  metadata: RouteInboundMessageMetadata;
  safeSendClassification: SafeSendClassifierResult;
  policy: ResponsePolicyEvaluation;
  resolvedOutboundMode: ResolvedOutboundMode;
  outboundDecision: OutboundDeliveryDecision;
  outboundTransport: OutboundTransportDispatchResult | null;
}

export interface ConversationOrchestratorDependencies {
  resolveConversation: (
    input: ConversationTurnRequest
  ) => Promise<Conversation>;
  fetchRecentMessages: (
    input: FetchRecentMessagesInput
  ) => Promise<Message[]>;
  routeInboundMessage: (
    input: RouteInboundMessageInput
  ) => Promise<RouteInboundMessageResult>;
  insertInboundMessage: (
    input: Omit<InsertMessageInput, "direction">
  ) => Promise<Message>;
  insertOutboundMessage: (
    input: Omit<InsertMessageInput, "direction">
  ) => Promise<Message>;
  insertAuditLog: (input: InsertAuditLogInput) => Promise<unknown>;
  classifyCandidateResponseForSafeSend: (
    input: SafeSendClassifierInput
  ) => SafeSendClassifierResult;
  evaluateResponsePolicy: (
    input: EvaluateResponsePolicyInput,
    options?: { now?: Date }
  ) => ResponsePolicyEvaluation;
  resolveOutboundMode: (tenantId: string) => Promise<ResolvedOutboundMode>;
  dispatchOutboundTransport: (
    input: DispatchOutboundTransportInput
  ) => Promise<OutboundTransportDispatchResult>;
  now: () => Date;
}

function normalizeRecentMessageRole(message: Message): VenueMessageRole {
  if (message.role === "assistant" || message.role === "system") {
    return message.role;
  }

  if (message.role === "user") {
    return "user";
  }

  return message.direction === "outbound" ? "assistant" : "user";
}

function toRouterRecentMessages(messages: readonly Message[]): VenueRecentMessage[] {
  return [...messages]
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .map((message) => ({
      role: normalizeRecentMessageRole(message),
      content: message.content,
      timestamp: message.created_at,
    }));
}

function buildInboundMessageMetadata(
  input: ConversationTurnRequest,
  recentMessages: readonly Message[]
): Json {
  return {
    ...(input.inbound.metadata ?? {}),
    sessionMemory: {
      strategy: "last_messages",
      limit: SESSION_MEMORY_LIMIT,
      recentMessageCount: recentMessages.length,
      recentMessageIds: recentMessages.map((message) => message.id),
    },
    receivedAt: input.inbound.receivedAt ?? null,
  };
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function toJsonObject(value: unknown): { [key: string]: Json | undefined } {
  return toJsonValue(value) as { [key: string]: Json | undefined };
}

function buildAiDraftMetadata(input: {
  classification: InboundRouteClassification;
  metadata: RouteInboundMessageMetadata;
  recentMessages: readonly Message[];
  inboundMessageId: string;
  conversationId: string;
  safeSendClassification: SafeSendClassifierResult;
  policy: ResponsePolicyEvaluation;
  resolvedOutboundMode: ResolvedOutboundMode;
  outboundDecision: OutboundDeliveryDecision;
  outboundTransport: OutboundTransportDispatchResult | null;
}): Json {
  return buildDraftVersionMetadata({
    existingMetadata: {
      kind: "ai_draft",
      route: toJsonObject(input.classification),
      responsePolicy: toJsonObject({
        decision: input.policy.decision,
        reasons: input.policy.reasons,
        transportAllowed: input.policy.transportAllowed,
        evaluatedAt: input.policy.evaluatedAt,
        routeConfidenceThreshold: input.policy.routeConfidenceThreshold,
      }),
      safeSendClassifier: toJsonObject(input.safeSendClassification),
      outboundMode: toJsonObject(input.resolvedOutboundMode),
      outboundDelivery: toJsonObject({
        action: input.outboundDecision.action,
        reasons: input.outboundDecision.reasons,
        transport: input.outboundTransport,
      }),
      sessionMemory: {
        strategy: "last_messages",
        limit: SESSION_MEMORY_LIMIT,
        recentMessageCount: input.recentMessages.length,
        recentMessageIds: input.recentMessages.map((message) => message.id),
      },
      router: {
        ...toJsonObject(input.metadata),
        persistence: toJsonObject({
          ...input.metadata.persistence,
          conversationId: input.conversationId,
          inboundMessageId: input.inboundMessageId,
        }),
      },
    },
    familyId: input.inboundMessageId,
    version: 1,
    originInboundMessageId: input.inboundMessageId,
    kind: "ai_draft",
    createdBy: "orchestrator",
    createdAt: input.policy.evaluatedAt,
  });
}

function getOutboundMessageStatus(
  outboundDecision: OutboundDeliveryDecision
): string {
  switch (outboundDecision.action) {
    case "proceed":
      return "ready_to_send";
    case "queue":
      return "queued_for_review";
    case "block":
      return "blocked";
    default: {
      const exhaustiveCheck: never = outboundDecision.action;
      return exhaustiveCheck;
    }
  }
}

function getAuditLogStatus(outboundDecision: OutboundDeliveryDecision): string {
  switch (outboundDecision.action) {
    case "proceed":
      return "succeeded";
    case "queue":
      return "review_required";
    case "block":
      return "blocked";
    default: {
      const exhaustiveCheck: never = outboundDecision.action;
      return exhaustiveCheck;
    }
  }
}

function buildResponsePolicyInput(input: {
  tenantId: string;
  inboundContent: string;
  classification: InboundRouteClassification;
  safeSendClassification: SafeSendClassifierResult;
}): EvaluateResponsePolicyInput {
  return {
    tenantState: input.tenantId.trim().length > 0 ? "present" : "missing",
    inboundBodyState:
      input.inboundContent.trim().length > 0 ? "present" : "missing",
    routeCategory: input.classification.category,
    routeConfidence: input.classification.confidence,
    escalationSignal: input.safeSendClassification.escalationSignal,
    pricingDiscussed: input.safeSendClassification.pricingDiscussed,
    availabilityDiscussed: input.safeSendClassification.availabilityDiscussed,
    pricingVerification: input.safeSendClassification.pricingVerification,
    availabilityVerification:
      input.safeSendClassification.availabilityVerification,
  };
}

export function createConversationOrchestrator(
  deps: ConversationOrchestratorDependencies
) {
  async function recordFailureAuditLog(input: {
    tenantId: string;
    conversationId?: string;
    stage: string;
    source: string;
    error: unknown;
  }) {
    const message =
      input.error instanceof Error ? input.error.message : "Unknown error";

    try {
      await deps.insertAuditLog({
        tenantId: input.tenantId,
        eventType: TURN_FAILED_EVENT,
        status: "failed",
        payload: {
          conversationId: input.conversationId ?? null,
          stage: input.stage,
          source: input.source,
          error: message,
        },
      });
    } catch (auditError) {
      console.error("Failed to persist conversation-turn failure audit log.", {
        auditError,
        conversationId: input.conversationId,
        stage: input.stage,
        source: input.source,
      });
    }
  }

  return async function orchestrateConversationTurn(
    input: ConversationTurnRequest
  ): Promise<OrchestrateConversationTurnResult> {
    let stage = "resolve_conversation";
    let conversation: Conversation | undefined;

    try {
      conversation = await deps.resolveConversation(input);

      stage = "fetch_recent_messages";
      const recentMessages = await deps.fetchRecentMessages({
        conversationId: conversation.id,
        limit: SESSION_MEMORY_LIMIT,
      });
      const routerRecentMessages = toRouterRecentMessages(recentMessages);

      stage = "route_inbound_message";
      const routedTurn = await deps.routeInboundMessage({
        message: input.inbound.content,
        venue: {
          id: input.venue.id,
          venueName: input.venue.venueName,
        },
        conversation: {
          id: conversation.id,
          recentMessages: routerRecentMessages,
        },
        receivedAt: input.inbound.receivedAt,
      });

      stage = "persist_inbound_message";
      const inboundMessage = await deps.insertInboundMessage({
        conversationId: conversation.id,
        role: input.inbound.role ?? "user",
        content: input.inbound.content,
        source: input.inbound.source,
        ghlMessageId: input.inbound.ghlMessageId ?? null,
        rawPayload: input.inbound.rawPayload ?? {},
        metadata: buildInboundMessageMetadata(input, recentMessages),
      });

      stage = "evaluate_response_policy";
      const safeSendClassification =
        deps.classifyCandidateResponseForSafeSend({
          candidateResponse: routedTurn.aiReply,
          route: routedTurn.classification,
        });
      const policy = deps.evaluateResponsePolicy(
        buildResponsePolicyInput({
          tenantId: input.tenantId,
          inboundContent: input.inbound.content,
          classification: routedTurn.classification,
          safeSendClassification,
        }),
        {
          now: deps.now(),
        }
      );
      const resolvedOutboundMode = await deps.resolveOutboundMode(input.tenantId);
      const outboundDecision = determineOutboundDelivery({
        policyDecision: policy.decision,
        resolvedMode: resolvedOutboundMode,
      });

      stage = "persist_ai_draft";
      const aiDraftMessage = await deps.insertOutboundMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: routedTurn.aiReply,
        source: AI_DRAFT_SOURCE,
        status: getOutboundMessageStatus(outboundDecision),
        metadata: buildAiDraftMetadata({
          classification: routedTurn.classification,
          metadata: routedTurn.metadata,
          recentMessages,
          inboundMessageId: inboundMessage.id,
          conversationId: conversation.id,
          safeSendClassification,
          policy,
          resolvedOutboundMode,
          outboundDecision,
          outboundTransport: null,
        }),
        policyDecision: policy.decision,
        policyReasons: policy.reasons,
        policyEvaluatedAt: policy.evaluatedAt,
      });
      let outboundTransport: OutboundTransportDispatchResult | null = null;

      if (outboundDecision.action === "proceed") {
        stage = "dispatch_outbound_transport";
        outboundTransport = await deps.dispatchOutboundTransport({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          outboundMessageId: aiDraftMessage.id,
          content: routedTurn.aiReply,
          policy,
          resolvedOutboundMode,
          outboundDecision,
        });
      }

      stage = "persist_audit_log";
      await deps.insertAuditLog({
        tenantId: input.tenantId,
        eventType: TURN_PERSISTED_EVENT,
        status: getAuditLogStatus(outboundDecision),
        payload: toJsonValue({
          conversationId: conversation.id,
          inboundMessageId: inboundMessage.id,
          aiDraftMessageId: aiDraftMessage.id,
          route: routedTurn.classification,
          replySource: routedTurn.metadata.replySource,
          source: input.inbound.source,
          responsePolicy: policy,
          outboundMode: resolvedOutboundMode,
          outboundDelivery: {
            action: outboundDecision.action,
            reasons: outboundDecision.reasons,
            transport: outboundTransport,
          },
          safeSendClassifier: safeSendClassification,
          sessionMemory: {
            strategy: "last_messages",
            limit: SESSION_MEMORY_LIMIT,
            recentMessageCount: recentMessages.length,
            recentMessageIds: recentMessages.map((message) => message.id),
          },
        }),
      });

      return {
        conversation,
        recentMessages,
        inboundMessage,
        aiDraftMessage,
        classification: routedTurn.classification,
        aiReply: routedTurn.aiReply,
        safeSendClassification,
        policy,
        resolvedOutboundMode,
        outboundDecision,
        outboundTransport,
        metadata: {
          ...routedTurn.metadata,
          persistence: {
            ...routedTurn.metadata.persistence,
            conversationId: conversation.id,
            inboundMessageId: inboundMessage.id,
          },
        },
      };
    } catch (error) {
      await recordFailureAuditLog({
        tenantId: input.tenantId,
        conversationId: conversation?.id,
        stage,
        source: input.inbound.source,
        error,
      });

      throw error;
    }
  };
}
