import "server-only";

import type {
  InboundRouteClassification,
  RouteInboundMessageMetadata,
} from "@/src/lib/llm/router";
import { routeInboundMessage } from "@/src/lib/llm/router";
import {
  createObservabilityContext,
  type ObservabilityContext,
  ValidationError,
} from "@/src/lib/observability";
import type { Database, Json } from "@/src/lib/db/supabase";
import type { VenueMessageRole, VenueRecentMessage } from "@/src/services/ai";
import { insertAuditLog } from "@/src/services/audit-logs";
import {
  findOrCreateConversation,
  getConversationById,
  getConversationWithMessagesForTenant,
  getTenantById,
} from "@/src/services/conversations";
import {
  AI_DRAFT_SOURCE,
  buildDraftVersionMetadata,
  getDraftVersionSnapshot,
  getNextDraftVersion,
} from "@/src/services/draft-history";
import {
  fetchRecentMessages,
  findMessageByGhlMessageId,
  insertInboundMessage,
  insertOutboundMessage,
  updateMessage,
} from "@/src/services/messages";
import {
  evaluateResponsePolicy,
  type ResponsePolicyEvaluation,
} from "@/src/services/response-policy";
import {
  getResolvedOutboundModeForTenant,
} from "@/src/services/outbound-settings";
import {
  determineOutboundDelivery,
  type OutboundDeliveryDecision,
  type ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import {
  dispatchOutboundTransport,
} from "@/src/services/outbound-transport";
import {
  classifyCandidateResponseForSafeSend,
  type SafeSendClassifierResult,
} from "@/src/services/safe-send-classifier";
import type {
  ConversationOrchestratorDependencies,
  ConversationTurnRequest,
} from "@/src/services/conversation-orchestrator-core";
import {
  createConversationOrchestrator as createConversationOrchestratorCore,
} from "@/src/services/conversation-orchestrator-core";

export {
  conversationTurnRequestSchema,
} from "@/src/services/conversation-orchestrator-core";
export type {
  ConversationOrchestratorDependencies,
  ConversationTurnRequest,
  OrchestrateConversationTurnResult,
} from "@/src/services/conversation-orchestrator-core";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

const SESSION_MEMORY_LIMIT = 5;
const OPERATOR_REGENERATE_EVENT = "operator_action.regenerate_draft";
const MISSION_CONTROL_OPERATOR = "Mission Control operator";

function isJsonObject(
  value: Json | null | undefined
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(
  value: Json | null | undefined
): { [key: string]: Json | undefined } | null {
  return isJsonObject(value) ? value : null;
}

function readString(value: Json | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function toJsonObject(value: unknown): { [key: string]: Json | undefined } {
  return toJsonValue(value) as { [key: string]: Json | undefined };
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

function buildResponsePolicyInput(input: {
  tenantId: string;
  inboundContent: string;
  classification: InboundRouteClassification;
  safeSendClassification: SafeSendClassifierResult;
}) {
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
  } as const;
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

function readDraftInboundMessageId(message: Message): string | null {
  const draftVersion = getDraftVersionSnapshot(message);

  if (draftVersion?.originInboundMessageId != null) {
    return draftVersion.originInboundMessageId;
  }

  const metadata = readJsonObject(message.metadata);
  const router = readJsonObject(metadata?.router);
  const persistence = readJsonObject(router?.persistence);
  return readString(persistence?.inboundMessageId);
}

function createRegeneratedOutboundDecision(
  rawDecision: OutboundDeliveryDecision
): OutboundDeliveryDecision {
  if (rawDecision.action === "block") {
    return rawDecision;
  }

  return {
    action: "queue",
    reasons: [
      {
        code: "operator_regenerated_for_review",
        detail:
          "A Mission Control operator regenerated the draft, which intentionally created a fresh review candidate instead of sending immediately.",
      },
      ...rawDecision.reasons,
    ],
  };
}

function buildRegeneratedDraftMetadata(input: {
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
  draftVersion: ReturnType<typeof getNextDraftVersion>;
}): Json {
  return buildDraftVersionMetadata({
    existingMetadata: {
      kind: "ai_draft",
      observability: toJsonObject(input.observability),
      route: toJsonObject(input.classification),
      responsePolicy: toJsonObject({
        decision: input.policy.decision,
        reasons: input.policy.reasons,
        transportAllowed: input.policy.transportAllowed,
        evaluatedAt: input.policy.evaluatedAt,
        routeConfidenceThreshold: input.policy.routeConfidenceThreshold,
        observability: toJsonObject(input.policy.observability),
      }),
      safeSendClassifier: toJsonObject(input.safeSendClassification),
      outboundMode: toJsonObject(input.resolvedOutboundMode),
      outboundDelivery: toJsonObject({
        action: input.outboundDecision.action,
        reasons: input.outboundDecision.reasons,
        transport: null,
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
    familyId: input.draftVersion.familyId,
    version: input.draftVersion.version,
    parentMessageId: input.draftVersion.parentMessageId,
    originInboundMessageId: input.draftVersion.originInboundMessageId,
    kind: input.draftVersion.kind,
    createdBy: "orchestrator",
    createdAt: input.policy.evaluatedAt,
  });
}

async function resolveConversationRecord(input: ConversationTurnRequest) {
  if (input.conversation.id != null) {
    const conversation = await getConversationById(input.conversation.id);

    if (conversation == null) {
      throw new ValidationError(
        `Conversation ${input.conversation.id} was not found for orchestration.`
      );
    }

    if (conversation.tenant_id !== input.tenantId) {
      throw new ValidationError(
        `Conversation ${input.conversation.id} does not belong to tenant ${input.tenantId}.`
      );
    }

    return conversation;
  }

  return findOrCreateConversation({
    tenantId: input.tenantId,
    ghlContactId: input.conversation.ghlContactId ?? null,
    ghlConversationId: input.conversation.ghlConversationId ?? null,
    status: input.conversation.status,
  });
}

function buildConversationOrchestratorDependencies(
  overrides: Partial<ConversationOrchestratorDependencies> = {}
): ConversationOrchestratorDependencies {
  return {
    resolveConversation: resolveConversationRecord,
    fetchRecentMessages,
    findMessageByGhlMessageId,
    routeInboundMessage,
    insertInboundMessage,
    insertOutboundMessage,
    insertAuditLog,
    classifyCandidateResponseForSafeSend,
    evaluateResponsePolicy,
    resolveOutboundMode: getResolvedOutboundModeForTenant,
    dispatchOutboundTransport,
    now: () => new Date(),
    ...overrides,
  };
}

export function createConversationOrchestrator(
  overrides: Partial<ConversationOrchestratorDependencies> = {}
) {
  return createConversationOrchestratorCore(
    buildConversationOrchestratorDependencies(overrides)
  );
}

export interface RegenerateConversationDraftInput {
  tenantId: string;
  conversationId: string;
  baseDraftMessageId: string;
  observability?: ObservabilityContext;
}

export interface RegenerateConversationDraftResult {
  observability: ObservabilityContext;
  conversation: Conversation;
  tenant: Tenant;
  sourceInboundMessage: Message;
  recentMessages: Message[];
  aiDraftMessage: Message;
  classification: InboundRouteClassification;
  aiReply: string;
  metadata: RouteInboundMessageMetadata;
  safeSendClassification: SafeSendClassifierResult;
  policy: ResponsePolicyEvaluation;
  resolvedOutboundMode: ResolvedOutboundMode;
  outboundDecision: OutboundDeliveryDecision;
}

export async function regenerateConversationDraft(
  input: RegenerateConversationDraftInput
): Promise<RegenerateConversationDraftResult> {
  const observability = createObservabilityContext(input.observability);
  const detail = await getConversationWithMessagesForTenant({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });

  if (detail == null) {
    throw new Error(
      `Conversation ${input.conversationId} was not found for draft regeneration.`
    );
  }

  const tenant = await getTenantById(detail.conversation.tenant_id);

  if (tenant == null) {
    throw new Error(
      `Conversation ${input.conversationId} belongs to a missing tenant ${detail.conversation.tenant_id}.`
    );
  }

  const baseDraftMessage = detail.messages.find(
    (message) => message.id === input.baseDraftMessageId
  );

  if (baseDraftMessage == null) {
    throw new Error(
      `Draft ${input.baseDraftMessageId} was not found in conversation ${input.conversationId}.`
    );
  }

  const inboundMessageId = readDraftInboundMessageId(baseDraftMessage);
  const sourceInboundMessage =
    (inboundMessageId != null
      ? detail.messages.find((message) => message.id === inboundMessageId)
      : undefined) ??
    [...detail.messages]
      .filter((message) => message.direction === "inbound")
      .at(-1);

  if (sourceInboundMessage == null) {
    throw new Error(
      `Draft ${input.baseDraftMessageId} does not reference an inbound message to regenerate from.`
    );
  }

  const recentMessages = detail.messages
    .filter((message) => message.created_at < sourceInboundMessage.created_at)
    .slice(-SESSION_MEMORY_LIMIT);
  const routedTurn = await routeInboundMessage({
    message: sourceInboundMessage.content,
    venue: {
      id: tenant.id,
      slug: tenant.slug,
      venueName: tenant.name,
    },
    conversation: {
      id: detail.conversation.id,
      recentMessages: toRouterRecentMessages(recentMessages),
    },
    observability,
    receivedAt: sourceInboundMessage.created_at,
  });
  const safeSendClassification = classifyCandidateResponseForSafeSend({
    candidateResponse: routedTurn.aiReply,
    route: routedTurn.classification,
  });
  const policy = evaluateResponsePolicy(
    buildResponsePolicyInput({
      tenantId: tenant.id,
      inboundContent: sourceInboundMessage.content,
      classification: routedTurn.classification,
      safeSendClassification,
    }),
    {
      now: new Date(),
      observability,
    }
  );
  const resolvedOutboundMode = await getResolvedOutboundModeForTenant(tenant.id);
  const outboundDecision = createRegeneratedOutboundDecision(
    determineOutboundDelivery({
      policyDecision: policy.decision,
      resolvedMode: resolvedOutboundMode,
    })
  );
  const draftVersion = getNextDraftVersion({
    baseMessage: baseDraftMessage,
    fallbackFamilyId: sourceInboundMessage.id,
    fallbackOriginInboundMessageId: sourceInboundMessage.id,
    kind: "regenerated_ai_draft",
  });
  const aiDraftMessage = await insertOutboundMessage({
    conversationId: detail.conversation.id,
    role: "assistant",
    content: routedTurn.aiReply,
    source: AI_DRAFT_SOURCE,
    status: getOutboundMessageStatus(outboundDecision),
    metadata: buildRegeneratedDraftMetadata({
      classification: routedTurn.classification,
      metadata: routedTurn.metadata,
      recentMessages,
      inboundMessageId: sourceInboundMessage.id,
      conversationId: detail.conversation.id,
      observability,
      safeSendClassification,
      policy,
      resolvedOutboundMode,
      outboundDecision,
      draftVersion,
    }),
    policyDecision: policy.decision,
    policyReasons: policy.reasons,
    policyEvaluatedAt: policy.evaluatedAt,
  });

  await updateMessage({
    messageId: baseDraftMessage.id,
    status: "superseded",
  });

  await insertAuditLog({
    tenantId: tenant.id,
    eventType: OPERATOR_REGENERATE_EVENT,
    requestId: observability.requestId,
    traceId: observability.traceId,
    status: getAuditLogStatus(outboundDecision),
    payload: toJsonValue({
      conversationId: detail.conversation.id,
      sourceInboundMessageId: sourceInboundMessage.id,
      previousDraftMessageId: baseDraftMessage.id,
      aiDraftMessageId: aiDraftMessage.id,
      operator: {
        type: "operator",
        label: MISSION_CONTROL_OPERATOR,
      },
      route: routedTurn.classification,
      responsePolicy: policy,
      outboundMode: resolvedOutboundMode,
      outboundDelivery: {
        action: outboundDecision.action,
        reasons: outboundDecision.reasons,
        transport: null,
      },
      safeSendClassifier: safeSendClassification,
      previousDraftVersion: getDraftVersionSnapshot(baseDraftMessage),
      nextDraftVersion: getDraftVersionSnapshot(aiDraftMessage),
    }),
  });

  return {
    observability,
    conversation: detail.conversation,
    tenant,
    sourceInboundMessage,
    recentMessages,
    aiDraftMessage,
    classification: routedTurn.classification,
    aiReply: routedTurn.aiReply,
    metadata: {
      ...routedTurn.metadata,
      observability,
      persistence: {
        ...routedTurn.metadata.persistence,
        conversationId: detail.conversation.id,
        inboundMessageId: sourceInboundMessage.id,
      },
    },
    safeSendClassification,
    policy,
    resolvedOutboundMode,
    outboundDecision,
  };
}

export const orchestrateConversationTurn = createConversationOrchestrator();
