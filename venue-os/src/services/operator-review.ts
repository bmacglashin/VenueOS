import type { Database, Json } from "@/src/lib/db/supabase";
import {
  classifyOperationalError,
  createObservabilityContext,
  getOperationalErrorMessage,
  type ObservabilityContext,
} from "@/src/lib/observability";
import {
  type RegenerateConversationDraftInput,
  type RegenerateConversationDraftResult,
} from "@/src/services/conversation-orchestrator";
import type { InsertAuditLogInput } from "@/src/services/audit-logs";
import {
  OPERATOR_EDIT_SOURCE,
  buildDraftVersionMetadata,
  getDraftVersionSnapshot,
  getLatestDraftVersionMessage,
  getNextDraftVersion,
} from "@/src/services/draft-history";
import {
  type InsertMessageInput,
  type UpdateMessageInput,
} from "@/src/services/messages";
import type {
  OutboundDeliveryDecision,
  ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import type {
  DispatchOutboundTransportInput,
  OutboundTransportDispatchResult,
} from "@/src/services/outbound-transport";
import {
  evaluateResponsePolicy,
  RESPONSE_POLICY_REASON_CODES,
  SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD,
  type ResponsePolicyEvaluation,
  type ResponsePolicyReasonCode,
  type ResponsePolicyReason,
} from "@/src/services/response-policy";
import {
  classifyCandidateResponseForSafeSend,
  type SafeSendClassifierResult,
} from "@/src/services/safe-send-classifier";
import type { InboundRouteClassification } from "@/src/lib/llm/router";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

const APPROVE_AND_SEND_EVENT = "operator_action.approve_and_send";
const EDIT_AND_SEND_EVENT = "operator_action.edit_and_send";
const NOTE_ADDED_EVENT = "operator_action.note_added";
const MISSION_CONTROL_OPERATOR = "Mission Control operator";

interface ReviewContext {
  conversation: Conversation;
  tenant: Tenant;
  messages: Message[];
  draftMessage: Message;
  sourceInboundMessage: Message | null;
}

export interface AddOperatorNoteInput {
  tenantId: string;
  conversationId: string;
  note: string;
  observability?: ObservabilityContext;
}

export interface ApproveDraftAndSendInput {
  tenantId: string;
  conversationId: string;
  draftMessageId?: string;
  observability?: ObservabilityContext;
}

export interface EditDraftAndSendInput {
  tenantId: string;
  conversationId: string;
  draftMessageId?: string;
  content: string;
  observability?: ObservabilityContext;
}

export interface OperatorReviewDependencies {
  getConversationById: (conversationId: string) => Promise<Conversation | null>;
  getTenantById: (tenantId: string) => Promise<Tenant | null>;
  listConversationMessages: (conversationId: string) => Promise<Message[]>;
  updateMessage: (input: UpdateMessageInput) => Promise<Message>;
  insertOutboundMessage: (
    input: Omit<InsertMessageInput, "direction">
  ) => Promise<Message>;
  insertAuditLog: (input: InsertAuditLogInput) => Promise<unknown>;
  resolveOutboundMode: (tenantId: string) => Promise<ResolvedOutboundMode>;
  dispatchOutboundTransport: (
    input: DispatchOutboundTransportInput
  ) => Promise<OutboundTransportDispatchResult>;
  classifyCandidateResponseForSafeSend: (
    input: Parameters<typeof classifyCandidateResponseForSafeSend>[0]
  ) => SafeSendClassifierResult;
  evaluateResponsePolicy: typeof evaluateResponsePolicy;
  regenerateConversationDraft: (
    input: RegenerateConversationDraftInput
  ) => Promise<RegenerateConversationDraftResult>;
  now: () => Date;
}

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

function readNumber(value: Json | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: Json | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readArray(value: Json | null | undefined): Json[] | null {
  return Array.isArray(value) ? value : null;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function toJsonObject(value: unknown): { [key: string]: Json | undefined } {
  return toJsonValue(value) as { [key: string]: Json | undefined };
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

function isResponsePolicyReasonCode(
  value: string | null
): value is ResponsePolicyReasonCode {
  return (
    value != null &&
    RESPONSE_POLICY_REASON_CODES.some((candidate) => candidate === value)
  );
}

function readStoredPolicyReasons(message: Message): ResponsePolicyReason[] {
  const storedReasons = readArray(message.policy_reasons);

  if (storedReasons != null) {
    const reasons = storedReasons.flatMap((reason) => {
      const reasonObject = readJsonObject(reason);
      const code = readString(reasonObject?.code);
      const detail = readString(reasonObject?.detail);

      if (!isResponsePolicyReasonCode(code) || detail == null) {
        return [];
      }

      return [
        {
          code,
          detail,
        } satisfies ResponsePolicyReason,
      ];
    });

    if (reasons.length > 0) {
      return reasons;
    }
  }

  const metadata = readJsonObject(message.metadata);
  const responsePolicy = readJsonObject(metadata?.responsePolicy);
  const reasons = readArray(responsePolicy?.reasons) ?? [];

  return reasons.flatMap((reason) => {
    const reasonObject = readJsonObject(reason);
    const code = readString(reasonObject?.code);
    const detail = readString(reasonObject?.detail);

    if (!isResponsePolicyReasonCode(code) || detail == null) {
      return [];
    }

    return [
      {
        code,
        detail,
      } satisfies ResponsePolicyReason,
    ];
  });
}

function readStoredPolicyEvaluation(
  message: Message,
  now: Date,
  observability: ObservabilityContext
): ResponsePolicyEvaluation {
  const metadata = readJsonObject(message.metadata);
  const responsePolicy = readJsonObject(metadata?.responsePolicy);
  const decision =
    readString(message.policy_decision) ??
    readString(responsePolicy?.decision) ??
    "needs_review";
  const routeConfidenceThreshold =
    readNumber(responsePolicy?.routeConfidenceThreshold) ??
    SAFE_SEND_ROUTE_CONFIDENCE_THRESHOLD;
  const evaluatedAt =
    readString(message.policy_evaluated_at) ??
    readString(responsePolicy?.evaluatedAt) ??
    now.toISOString();

  return {
    decision:
      decision === "safe_to_send" ||
      decision === "needs_review" ||
      decision === "block_send"
        ? decision
        : "needs_review",
    reasons: readStoredPolicyReasons(message),
    transportAllowed: decision === "safe_to_send",
    routeConfidenceThreshold,
    evaluatedAt,
    observability,
  };
}

function readStoredRouteClassification(
  message: Message
): InboundRouteClassification {
  const metadata = readJsonObject(message.metadata);
  const route = readJsonObject(metadata?.route);
  const category = readString(route?.category);
  const confidence = readNumber(route?.confidence);
  const requiresHumanReview = readBoolean(route?.requiresHumanReview);
  const rationale = readString(route?.rationale);

  if (
    category == null ||
    confidence == null ||
    requiresHumanReview == null ||
    rationale == null
  ) {
    throw new Error(`Draft ${message.id} is missing stored route metadata.`);
  }

  return {
    category: category as InboundRouteClassification["category"],
    confidence,
    requiresHumanReview,
    rationale,
  };
}

function summarizeExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function getTransportedMessageStatus(
  transport: OutboundTransportDispatchResult
): string {
  switch (transport.outcome) {
    case "skipped":
      return "send_skipped";
    default:
      return "sent";
  }
}

function ensureSendAllowed(resolvedOutboundMode: ResolvedOutboundMode) {
  if (resolvedOutboundMode.mode === "disabled") {
    throw new Error(
      "Outbound sending is disabled for this tenant, so the operator cannot send this draft yet."
    );
  }
}

function buildOperatorReason(
  code: "operator_approved_send" | "operator_edited_send"
): OutboundDeliveryDecision["reasons"][number] {
  return {
    code,
    detail:
      code === "operator_approved_send"
        ? "A Mission Control operator approved the queued draft and moved it onto the shared transport path."
        : "A Mission Control operator edited the draft and sent the revised version through the shared transport path.",
  };
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

function mergeMessageMetadata(
  existingMetadata: Json | null | undefined,
  patches: Array<{ [key: string]: unknown }>
): Json {
  const base = readJsonObject(existingMetadata) ?? {};

  return toJsonValue(
    patches.reduce(
      (accumulator, patch) => ({
        ...accumulator,
        ...patch,
      }),
      { ...base }
    )
  );
}

function buildApprovedDraftMetadata(input: {
  draftMessage: Message;
  resolvedOutboundMode: ResolvedOutboundMode;
  transport: OutboundTransportDispatchResult;
  actedAt: string;
  observability: ObservabilityContext;
}): Json {
  const metadata = readJsonObject(input.draftMessage.metadata);
  const outboundDelivery = readJsonObject(metadata?.outboundDelivery);

  return mergeMessageMetadata(input.draftMessage.metadata, [
    {
      observability: toJsonObject(input.observability),
    },
    {
      outboundMode: toJsonObject(input.resolvedOutboundMode),
      outboundDelivery: {
        ...outboundDelivery,
        action: "proceed",
        reasons: [buildOperatorReason("operator_approved_send")],
        transport: input.transport,
      },
    },
    {
      operatorReview: {
        actor: {
          type: "operator",
          label: MISSION_CONTROL_OPERATOR,
        },
        actedAt: input.actedAt,
        action: "approve_and_send",
      },
    },
  ]);
}

function buildEditedDraftMetadata(input: {
  baseDraftMessage: Message;
  content: string;
  policy: ResponsePolicyEvaluation;
  safeSendClassification: SafeSendClassifierResult;
  resolvedOutboundMode: ResolvedOutboundMode;
  transport: OutboundTransportDispatchResult | null;
  actedAt: string;
  observability: ObservabilityContext;
}): Json {
  const metadata = readJsonObject(input.baseDraftMessage.metadata);
  const router = readJsonObject(metadata?.router);
  const route = readStoredRouteClassification(input.baseDraftMessage);
  const draftVersion = getNextDraftVersion({
    baseMessage: input.baseDraftMessage,
    fallbackFamilyId:
      readDraftInboundMessageId(input.baseDraftMessage) ??
      input.baseDraftMessage.id,
    fallbackOriginInboundMessageId: readDraftInboundMessageId(
      input.baseDraftMessage
    ),
    kind: "operator_edit",
  });

  return buildDraftVersionMetadata({
    existingMetadata: {
      ...metadata,
      kind: "operator_edit",
      observability: toJsonObject(input.observability),
      route: toJsonObject(route),
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
        action: "proceed",
        reasons: [buildOperatorReason("operator_edited_send")],
        transport: input.transport,
      }),
      router: router == null ? undefined : toJsonObject(router),
      operatorReview: {
        actor: {
          type: "operator",
          label: MISSION_CONTROL_OPERATOR,
        },
        actedAt: input.actedAt,
        action: "edit_and_send",
        editedFromMessageId: input.baseDraftMessage.id,
        editedExcerpt: summarizeExcerpt(input.content),
      },
    },
    familyId: draftVersion.familyId,
    version: draftVersion.version,
    parentMessageId: draftVersion.parentMessageId,
    originInboundMessageId: draftVersion.originInboundMessageId,
    kind: "operator_edit",
    createdBy: "operator",
    createdAt: input.actedAt,
  });
}

async function resolveReviewContext(
  deps: OperatorReviewDependencies,
  input: {
    tenantId: string;
    conversationId: string;
    draftMessageId?: string;
  }
): Promise<ReviewContext> {
  const conversation = await deps.getConversationById(input.conversationId);

  if (conversation == null) {
    throw new Error(`Conversation ${input.conversationId} was not found.`);
  }

  if (conversation.tenant_id !== input.tenantId) {
    throw new Error(
      `Conversation ${input.conversationId} does not belong to tenant ${input.tenantId}.`
    );
  }

  const tenant = await deps.getTenantById(conversation.tenant_id);

  if (tenant == null) {
    throw new Error(
      `Conversation ${conversation.id} belongs to a missing tenant ${conversation.tenant_id}.`
    );
  }

  const messages = await deps.listConversationMessages(conversation.id);
  const latestDraftMessage = getLatestDraftVersionMessage(messages);

  if (latestDraftMessage == null) {
    throw new Error(
      `Conversation ${conversation.id} does not have a stored draft version to act on.`
    );
  }

  if (
    input.draftMessageId != null &&
    latestDraftMessage.id !== input.draftMessageId
  ) {
    throw new Error(
      "The conversation has a newer draft version than the one on this page. Refresh and try again."
    );
  }

  const sourceInboundMessageId = readDraftInboundMessageId(latestDraftMessage);
  const sourceInboundMessage =
    (sourceInboundMessageId != null
      ? messages.find((message) => message.id === sourceInboundMessageId)
      : undefined) ??
    [...messages]
      .filter((message) => message.direction === "inbound")
      .at(-1) ??
    null;

  return {
    conversation,
    tenant,
    messages,
    draftMessage: latestDraftMessage,
    sourceInboundMessage,
  };
}

async function recordFailedOperatorAuditLog(
  deps: OperatorReviewDependencies,
  input: {
    tenantId: string;
    eventType: InsertAuditLogInput["eventType"];
    observability: ObservabilityContext;
    conversationId: string;
    draftMessageId?: string;
    error: unknown;
  }
) {
  const errorType = classifyOperationalError(input.error);
  const message = getOperationalErrorMessage(input.error);

  try {
    await deps.insertAuditLog({
      tenantId: input.tenantId,
      eventType: input.eventType,
      requestId: input.observability.requestId,
      traceId: input.observability.traceId,
      errorType,
      status: "failed",
      payload: toJsonValue({
        conversationId: input.conversationId,
        draftMessageId: input.draftMessageId ?? null,
        operator: {
          type: "operator",
          label: MISSION_CONTROL_OPERATOR,
        },
        error: message,
      }),
    });
  } catch (auditError) {
    console.error("Failed to record operator review audit log failure.", {
      auditError,
      conversationId: input.conversationId,
      eventType: input.eventType,
    });
  }
}

async function defaultGetConversationById(conversationId: string) {
  const { getConversationById } = await import("@/src/services/conversations");
  return getConversationById(conversationId);
}

async function defaultGetTenantById(tenantId: string) {
  const { getTenantById } = await import("@/src/services/conversations");
  return getTenantById(tenantId);
}

async function defaultListConversationMessages(conversationId: string) {
  const { listConversationMessages } = await import("@/src/services/messages");
  return listConversationMessages(conversationId);
}

async function defaultUpdateMessage(input: UpdateMessageInput) {
  const { updateMessage } = await import("@/src/services/messages");
  return updateMessage(input);
}

async function defaultInsertOutboundMessage(
  input: Omit<InsertMessageInput, "direction">
) {
  const { insertOutboundMessage } = await import("@/src/services/messages");
  return insertOutboundMessage(input);
}

async function defaultInsertAuditLog(input: {
  tenantId: string;
  eventType: InsertAuditLogInput["eventType"];
  requestId: string;
  traceId: string;
  errorType?: InsertAuditLogInput["errorType"];
  payload?: Json;
  status?: string;
}) {
  const { insertAuditLog } = await import("@/src/services/audit-logs");
  return insertAuditLog(input);
}

async function defaultResolveOutboundMode(tenantId: string) {
  const { getResolvedOutboundModeForTenant } = await import(
    "@/src/services/outbound-settings"
  );
  return getResolvedOutboundModeForTenant(tenantId);
}

async function defaultDispatchOutboundTransport(
  input: DispatchOutboundTransportInput
) {
  const { dispatchOutboundTransport } = await import(
    "@/src/services/outbound-transport"
  );
  return dispatchOutboundTransport(input);
}

async function defaultRegenerateConversationDraft(
  input: RegenerateConversationDraftInput
) {
  const { regenerateConversationDraft } = await import(
    "@/src/services/conversation-orchestrator"
  );
  return regenerateConversationDraft(input);
}

export function createOperatorReviewService(
  overrides: Partial<OperatorReviewDependencies> = {}
) {
  const deps: OperatorReviewDependencies = {
    getConversationById: defaultGetConversationById,
    getTenantById: defaultGetTenantById,
    listConversationMessages: defaultListConversationMessages,
    updateMessage: defaultUpdateMessage,
    insertOutboundMessage: defaultInsertOutboundMessage,
    insertAuditLog: defaultInsertAuditLog,
    resolveOutboundMode: defaultResolveOutboundMode,
    dispatchOutboundTransport: defaultDispatchOutboundTransport,
    classifyCandidateResponseForSafeSend,
    evaluateResponsePolicy,
    regenerateConversationDraft: defaultRegenerateConversationDraft,
    now: () => new Date(),
    ...overrides,
  };

  return {
    async addManualNote(input: AddOperatorNoteInput) {
      const note = input.note.trim();
      const observability = createObservabilityContext(input.observability);

      if (note.length === 0) {
        throw new Error("A manual note is required.");
      }

      const context = await resolveReviewContext(deps, {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      });

      await deps.insertAuditLog({
        tenantId: context.tenant.id,
        eventType: NOTE_ADDED_EVENT,
        requestId: observability.requestId,
        traceId: observability.traceId,
        status: "recorded",
        payload: toJsonValue({
          conversationId: context.conversation.id,
          draftMessageId: context.draftMessage.id,
          operator: {
            type: "operator",
            label: MISSION_CONTROL_OPERATOR,
          },
          note,
        }),
      });

      return {
        conversation: context.conversation,
        draftMessage: context.draftMessage,
      };
    },

    async approveDraftAndSend(input: ApproveDraftAndSendInput) {
      const context = await resolveReviewContext(deps, input);
      const actedAt = deps.now().toISOString();
      const observability = createObservabilityContext(input.observability);

      try {
        const policy = readStoredPolicyEvaluation(
          context.draftMessage,
          deps.now(),
          observability
        );
        const resolvedOutboundMode = await deps.resolveOutboundMode(
          context.tenant.id
        );

        ensureSendAllowed(resolvedOutboundMode);

        const outboundDecision: OutboundDeliveryDecision = {
          action: "proceed",
          reasons: [buildOperatorReason("operator_approved_send")],
        };
        const transport = await deps.dispatchOutboundTransport({
          tenantId: context.tenant.id,
          conversationId: context.conversation.id,
          outboundMessageId: context.draftMessage.id,
          content: context.draftMessage.content,
          observability,
          policy,
          resolvedOutboundMode,
          outboundDecision,
        });
        const updatedDraftMessage = await deps.updateMessage({
          messageId: context.draftMessage.id,
          status: getTransportedMessageStatus(transport),
          metadata: buildApprovedDraftMetadata({
            draftMessage: context.draftMessage,
            resolvedOutboundMode,
            transport,
            actedAt,
            observability,
          }),
        });

        await deps.insertAuditLog({
          tenantId: context.tenant.id,
          eventType: APPROVE_AND_SEND_EVENT,
          requestId: observability.requestId,
          traceId: observability.traceId,
          status: "succeeded",
          payload: toJsonValue({
            conversationId: context.conversation.id,
            draftMessageId: context.draftMessage.id,
            operator: {
              type: "operator",
              label: MISSION_CONTROL_OPERATOR,
            },
            responsePolicy: policy,
            outboundMode: resolvedOutboundMode,
            outboundDelivery: {
              action: outboundDecision.action,
              reasons: outboundDecision.reasons,
              transport,
            },
            draftVersion: getDraftVersionSnapshot(updatedDraftMessage),
          }),
        });

        return {
          conversation: context.conversation,
          draftMessage: updatedDraftMessage,
          transport,
        };
      } catch (error) {
        await recordFailedOperatorAuditLog(deps, {
          tenantId: context.tenant.id,
          eventType: APPROVE_AND_SEND_EVENT,
          observability,
          conversationId: context.conversation.id,
          draftMessageId: context.draftMessage.id,
          error,
        });

        throw error;
      }
    },

    async editDraftAndSend(input: EditDraftAndSendInput) {
      const content = input.content.trim();
      const observability = createObservabilityContext(input.observability);

      if (content.length === 0) {
        throw new Error("Edited content is required before sending.");
      }

      const context = await resolveReviewContext(deps, input);
      const actedAt = deps.now().toISOString();

      try {
        const classification = readStoredRouteClassification(context.draftMessage);
        const safeSendClassification = deps.classifyCandidateResponseForSafeSend({
          candidateResponse: content,
          route: classification,
        });
        const policy = deps.evaluateResponsePolicy(
          buildResponsePolicyInput({
            tenantId: context.tenant.id,
            inboundContent: context.sourceInboundMessage?.content ?? "",
            classification,
            safeSendClassification,
          }),
          {
            now: deps.now(),
            observability,
          }
        );
        const resolvedOutboundMode = await deps.resolveOutboundMode(
          context.tenant.id
        );

        ensureSendAllowed(resolvedOutboundMode);

        const draftMetadata = buildEditedDraftMetadata({
          baseDraftMessage: context.draftMessage,
          content,
          policy,
          safeSendClassification,
          resolvedOutboundMode,
          transport: null,
          actedAt,
          observability,
        });
        const insertedEditedMessage = await deps.insertOutboundMessage({
          conversationId: context.conversation.id,
          role: "assistant",
          content,
          source: OPERATOR_EDIT_SOURCE,
          status: "ready_to_send",
          metadata: draftMetadata,
          policyDecision: policy.decision,
          policyReasons: policy.reasons,
          policyEvaluatedAt: policy.evaluatedAt,
        });
        const outboundDecision: OutboundDeliveryDecision = {
          action: "proceed",
          reasons: [buildOperatorReason("operator_edited_send")],
        };
        const transport = await deps.dispatchOutboundTransport({
          tenantId: context.tenant.id,
          conversationId: context.conversation.id,
          outboundMessageId: insertedEditedMessage.id,
          content,
          observability,
          policy,
          resolvedOutboundMode,
          outboundDecision,
        });
        const finalEditedMessage = await deps.updateMessage({
          messageId: insertedEditedMessage.id,
          status: getTransportedMessageStatus(transport),
          metadata: buildEditedDraftMetadata({
            baseDraftMessage: context.draftMessage,
            content,
            policy,
            safeSendClassification,
            resolvedOutboundMode,
            transport,
            actedAt,
            observability,
          }),
        });

        await deps.updateMessage({
          messageId: context.draftMessage.id,
          status: "superseded",
        });

        await deps.insertAuditLog({
          tenantId: context.tenant.id,
          eventType: EDIT_AND_SEND_EVENT,
          requestId: observability.requestId,
          traceId: observability.traceId,
          status: "succeeded",
          payload: toJsonValue({
            conversationId: context.conversation.id,
            sourceInboundMessageId: context.sourceInboundMessage?.id ?? null,
            previousDraftMessageId: context.draftMessage.id,
            sentDraftMessageId: finalEditedMessage.id,
            operator: {
              type: "operator",
              label: MISSION_CONTROL_OPERATOR,
            },
            editedFromExcerpt: summarizeExcerpt(context.draftMessage.content),
            editedToExcerpt: summarizeExcerpt(content),
            responsePolicy: policy,
            outboundMode: resolvedOutboundMode,
            outboundDelivery: {
              action: outboundDecision.action,
              reasons: outboundDecision.reasons,
              transport,
            },
            previousDraftVersion: getDraftVersionSnapshot(context.draftMessage),
            nextDraftVersion: getDraftVersionSnapshot(finalEditedMessage),
          }),
        });

        return {
          conversation: context.conversation,
          previousDraftMessage: context.draftMessage,
          sentDraftMessage: finalEditedMessage,
          transport,
        };
      } catch (error) {
        await recordFailedOperatorAuditLog(deps, {
          tenantId: context.tenant.id,
          eventType: EDIT_AND_SEND_EVENT,
          observability,
          conversationId: context.conversation.id,
          draftMessageId: context.draftMessage.id,
          error,
        });

        throw error;
      }
    },

    async regenerateDraft(input: ApproveDraftAndSendInput) {
      const context = await resolveReviewContext(deps, input);
      const observability = createObservabilityContext(input.observability);

      try {
        return deps.regenerateConversationDraft({
          tenantId: context.tenant.id,
          conversationId: context.conversation.id,
          baseDraftMessageId: context.draftMessage.id,
          observability,
        });
      } catch (error) {
        await recordFailedOperatorAuditLog(deps, {
          tenantId: context.tenant.id,
          eventType: "operator_action.regenerate_draft",
          observability,
          conversationId: context.conversation.id,
          draftMessageId: context.draftMessage.id,
          error,
        });

        throw error;
      }
    },
  };
}

export const operatorReviewService = createOperatorReviewService();

export async function addOperatorNote(input: AddOperatorNoteInput) {
  return operatorReviewService.addManualNote(input);
}

export async function approveDraftAndSend(input: ApproveDraftAndSendInput) {
  return operatorReviewService.approveDraftAndSend(input);
}

export async function editDraftAndSend(input: EditDraftAndSendInput) {
  return operatorReviewService.editDraftAndSend(input);
}

export async function regenerateDraft(input: ApproveDraftAndSendInput) {
  return operatorReviewService.regenerateDraft(input);
}
