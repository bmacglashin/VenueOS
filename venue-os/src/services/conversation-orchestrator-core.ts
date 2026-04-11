import { z } from "zod";

import type {
  InboundRouteClassification,
  RouteInboundMessageInput,
  RouteInboundMessageMetadata,
  RouteInboundMessageResult,
} from "@/src/lib/llm/router";
import type { Database, Json } from "@/src/lib/db/supabase";
import {
  classifyOperationalError,
  createObservabilityContext,
  getOperationalErrorMessage,
  IdempotencyDropError,
  type ObservabilityContext,
  type StructuredEventName,
} from "@/src/lib/observability";
import type { VenueMessageRole, VenueRecentMessage } from "@/src/services/ai";
import type { InsertAuditLogInput } from "@/src/services/audit-logs";
import type {
  FetchRecentMessagesInput,
  FindMessageByGhlMessageIdInput,
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
const ROUTE_CLASSIFIED_EVENT = "route.classified";
const POLICY_EVALUATED_EVENT = "policy.evaluated";
const RESPONSE_DRAFTED_EVENT = "response.drafted";
const REVIEW_QUEUED_EVENT = "review.queued";
const OUTBOUND_SENT_EVENT = "outbound.sent";
const OUTBOUND_FAILED_EVENT = "outbound.failed";
const ORCHESTRATION_HALTED_EVENT = "orchestration.halted";
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
  observability: z
    .object({
      requestId: z.string().trim().min(1),
      traceId: z.string().trim().min(1),
    })
    .optional(),
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
  observability: ObservabilityContext;
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
  findMessageByGhlMessageId: (
    input: FindMessageByGhlMessageIdInput
  ) => Promise<Message | null>;
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
    options?: { now?: Date; observability?: ObservabilityContext }
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
  recentMessages: readonly Message[],
  observability: ObservabilityContext
): Json {
  return {
    ...(input.inbound.metadata ?? {}),
    observability,
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
  observability: ObservabilityContext;
  safeSendClassification: SafeSendClassifierResult;
  policy: ResponsePolicyEvaluation;
  resolvedOutboundMode: ResolvedOutboundMode;
  outboundDecision: OutboundDeliveryDecision;
  outboundTransport: OutboundTransportDispatchResult | null;
}): Json {
  return buildDraftVersionMetadata({
    existingMetadata: {
      kind: "ai_draft",
      observability: input.observability,
      route: toJsonObject(input.classification),
      responsePolicy: toJsonObject({
        decision: input.policy.decision,
        reasons: input.policy.reasons,
        transportAllowed: input.policy.transportAllowed,
        evaluatedAt: input.policy.evaluatedAt,
        routeConfidenceThreshold: input.policy.routeConfidenceThreshold,
        observability: input.policy.observability,
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
  async function recordAuditEvent(input: {
    tenantId: string;
    eventType: StructuredEventName;
    observability: ObservabilityContext;
    payload?: Json;
    status?: string;
    errorType?: InsertAuditLogInput["errorType"];
  }) {
    await deps.insertAuditLog({
      tenantId: input.tenantId,
      eventType: input.eventType,
      requestId: input.observability.requestId,
      traceId: input.observability.traceId,
      errorType: input.errorType ?? null,
      payload: input.payload,
      status: input.status,
    });
  }

  async function recordHaltedAuditLog(input: {
    tenantId: string;
    observability: ObservabilityContext;
    conversationId?: string;
    inboundMessageId?: string;
    outboundMessageId?: string;
    stage: string;
    source: string;
    error: unknown;
  }) {
    const errorType = classifyOperationalError(input.error);
    const message = getOperationalErrorMessage(input.error);

    try {
      await recordAuditEvent({
        tenantId: input.tenantId,
        eventType: ORCHESTRATION_HALTED_EVENT,
        observability: input.observability,
        status: errorType === "idempotency_drop" ? "dropped" : "failed",
        errorType,
        payload: {
          conversationId: input.conversationId ?? null,
          inboundMessageId: input.inboundMessageId ?? null,
          outboundMessageId: input.outboundMessageId ?? null,
          stage: input.stage,
          source: input.source,
          errorType,
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
    const observability = createObservabilityContext(input.observability);
    let stage = "resolve_conversation";
    let conversation: Conversation | undefined;
    let inboundMessage: Message | undefined;
    let aiDraftMessage: Message | undefined;
    let failureEventRecorded = false;

    try {
      conversation = await deps.resolveConversation(input);

      stage = "check_idempotency";
      if (input.inbound.ghlMessageId != null) {
        const existingInboundMessage = await deps.findMessageByGhlMessageId({
          ghlMessageId: input.inbound.ghlMessageId,
        });

        if (existingInboundMessage != null) {
          throw new IdempotencyDropError(
            `Inbound message ${input.inbound.ghlMessageId} was already processed.`
          );
        }
      }

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
        observability,
        receivedAt: input.inbound.receivedAt,
      });
      await recordAuditEvent({
        tenantId: input.tenantId,
        eventType: ROUTE_CLASSIFIED_EVENT,
        observability,
        status: "recorded",
        payload: toJsonValue({
          conversationId: conversation.id,
          source: input.inbound.source,
          route: routedTurn.classification,
          replySource: routedTurn.metadata.replySource,
          router: routedTurn.metadata.persistence,
        }),
      });

      stage = "persist_inbound_message";
      inboundMessage = await deps.insertInboundMessage({
        conversationId: conversation.id,
        role: input.inbound.role ?? "user",
        content: input.inbound.content,
        source: input.inbound.source,
        ghlMessageId: input.inbound.ghlMessageId ?? null,
        rawPayload: input.inbound.rawPayload ?? {},
        metadata: buildInboundMessageMetadata(
          input,
          recentMessages,
          observability
        ),
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
          observability,
        }
      );
      const resolvedOutboundMode = await deps.resolveOutboundMode(input.tenantId);
      const outboundDecision = determineOutboundDelivery({
        policyDecision: policy.decision,
        resolvedMode: resolvedOutboundMode,
      });
      await recordAuditEvent({
        tenantId: input.tenantId,
        eventType: POLICY_EVALUATED_EVENT,
        observability,
        status: "recorded",
        payload: toJsonValue({
          conversationId: conversation.id,
          inboundMessageId: inboundMessage.id,
          responsePolicy: policy,
          outboundMode: resolvedOutboundMode,
          outboundDelivery: {
            action: outboundDecision.action,
            reasons: outboundDecision.reasons,
          },
          safeSendClassifier: safeSendClassification,
        }),
      });

      stage = "persist_ai_draft";
      aiDraftMessage = await deps.insertOutboundMessage({
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
          observability,
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
      await recordAuditEvent({
        tenantId: input.tenantId,
        eventType: RESPONSE_DRAFTED_EVENT,
        observability,
        status: getOutboundMessageStatus(outboundDecision),
        payload: toJsonValue({
          conversationId: conversation.id,
          inboundMessageId: inboundMessage.id,
          aiDraftMessageId: aiDraftMessage.id,
          route: routedTurn.classification,
          responsePolicy: policy,
          outboundMode: resolvedOutboundMode,
          outboundDelivery: {
            action: outboundDecision.action,
            reasons: outboundDecision.reasons,
          },
        }),
      });
      let outboundTransport: OutboundTransportDispatchResult | null = null;

      if (outboundDecision.action === "queue") {
        await recordAuditEvent({
          tenantId: input.tenantId,
          eventType: REVIEW_QUEUED_EVENT,
          observability,
          status: "review_required",
          payload: toJsonValue({
            conversationId: conversation.id,
            aiDraftMessageId: aiDraftMessage.id,
            responsePolicy: policy,
            outboundDelivery: {
              action: outboundDecision.action,
              reasons: outboundDecision.reasons,
            },
          }),
        });
      }

      if (outboundDecision.action === "proceed") {
        stage = "dispatch_outbound_transport";
        try {
          outboundTransport = await deps.dispatchOutboundTransport({
            tenantId: input.tenantId,
            conversationId: conversation.id,
            outboundMessageId: aiDraftMessage.id,
            content: routedTurn.aiReply,
            observability,
            policy,
            resolvedOutboundMode,
            outboundDecision,
          });
          await recordAuditEvent({
            tenantId: input.tenantId,
            eventType: OUTBOUND_SENT_EVENT,
            observability,
            status: getAuditLogStatus(outboundDecision),
            payload: toJsonValue({
              conversationId: conversation.id,
              aiDraftMessageId: aiDraftMessage.id,
              outboundDelivery: {
                action: outboundDecision.action,
                reasons: outboundDecision.reasons,
                transport: outboundTransport,
              },
            }),
          });
        } catch (error) {
          failureEventRecorded = true;
          await recordAuditEvent({
            tenantId: input.tenantId,
            eventType: OUTBOUND_FAILED_EVENT,
            observability,
            status: "failed",
            errorType: classifyOperationalError(error),
            payload: toJsonValue({
              conversationId: conversation.id,
              aiDraftMessageId: aiDraftMessage.id,
              outboundDelivery: {
                action: outboundDecision.action,
                reasons: outboundDecision.reasons,
              },
              error: getOperationalErrorMessage(error),
            }),
          });
          throw error;
        }
      }

      return {
        observability,
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
          observability,
          persistence: {
            ...routedTurn.metadata.persistence,
            conversationId: conversation.id,
            inboundMessageId: inboundMessage.id,
          },
        },
      };
    } catch (error) {
      if (!failureEventRecorded) {
        await recordHaltedAuditLog({
          tenantId: input.tenantId,
          observability,
          conversationId: conversation?.id,
          inboundMessageId: inboundMessage?.id,
          outboundMessageId: aiDraftMessage?.id,
          stage,
          source: input.inbound.source,
          error,
        });
      }

      throw error;
    }
  };
}
