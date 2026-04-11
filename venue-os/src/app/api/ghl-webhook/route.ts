import { NextResponse } from "next/server";

import type { Json } from "@/src/lib/db/supabase";
import {
  applyObservabilityHeaders,
  classifyOperationalError,
  createObservabilityContextFromHeaders,
  getOperationalErrorMessage,
  type ObservabilityContext,
  type OperationalErrorType,
} from "@/src/lib/observability";
import { insertAuditLog } from "@/src/services/audit-logs";
import { orchestrateConversationTurn } from "@/src/services/conversation-orchestrator";
import {
  findOrCreateConversation,
  getTenantByGhlLocationId,
} from "@/src/services/conversations";

type FieldPath = readonly string[];
type JsonObject = { [key: string]: Json | undefined };

interface ParsedWebhookRequest {
  rawBody: string;
  payload: unknown;
  parseError: string | null;
}

interface ExtractedField {
  value: string | null;
  path: string | null;
}

interface ExtractedWebhookFields {
  locationId: ExtractedField;
  contactId: ExtractedField;
  conversationId: ExtractedField;
  messageBody: ExtractedField;
  messageId: ExtractedField;
  receivedAt: ExtractedField;
}

const WEBHOOK_SOURCE = "ghl_webhook_internal";
const INBOUND_RECEIVED_EVENT = "inbound.received";
const ORCHESTRATION_HALTED_EVENT = "orchestration.halted";

const LOCATION_ID_PATHS: readonly FieldPath[] = [
  ["locationId"],
  ["location_id"],
  ["location", "id"],
  ["location"],
  ["payload", "locationId"],
  ["payload", "location_id"],
  ["payload", "location", "id"],
  ["payload", "location"],
  ["data", "locationId"],
  ["data", "location_id"],
  ["data", "location", "id"],
  ["data", "location"],
];

const CONTACT_ID_PATHS: readonly FieldPath[] = [
  ["contactId"],
  ["contact_id"],
  ["contact", "id"],
  ["payload", "contactId"],
  ["payload", "contact_id"],
  ["payload", "contact", "id"],
  ["data", "contactId"],
  ["data", "contact_id"],
  ["data", "contact", "id"],
];

const CONVERSATION_ID_PATHS: readonly FieldPath[] = [
  ["conversationId"],
  ["conversation_id"],
  ["conversation", "id"],
  ["payload", "conversationId"],
  ["payload", "conversation_id"],
  ["payload", "conversation", "id"],
  ["data", "conversationId"],
  ["data", "conversation_id"],
  ["data", "conversation", "id"],
];

const MESSAGE_BODY_PATHS: readonly FieldPath[] = [
  ["message", "body"],
  ["message", "text"],
  ["message", "content"],
  ["payload", "message", "body"],
  ["payload", "message", "text"],
  ["payload", "message", "content"],
  ["data", "message", "body"],
  ["data", "message", "text"],
  ["data", "message", "content"],
  ["messageBody"],
  ["payload", "messageBody"],
  ["data", "messageBody"],
  ["body"],
  ["payload", "body"],
  ["data", "body"],
  ["text"],
  ["payload", "text"],
  ["data", "text"],
  ["content"],
  ["payload", "content"],
  ["data", "content"],
  ["message"],
  ["payload", "message"],
  ["data", "message"],
];

const MESSAGE_ID_PATHS: readonly FieldPath[] = [
  ["messageId"],
  ["message_id"],
  ["message", "id"],
  ["payload", "messageId"],
  ["payload", "message_id"],
  ["payload", "message", "id"],
  ["data", "messageId"],
  ["data", "message_id"],
  ["data", "message", "id"],
];

const RECEIVED_AT_PATHS: readonly FieldPath[] = [
  ["receivedAt"],
  ["timestamp"],
  ["createdAt"],
  ["message", "timestamp"],
  ["message", "createdAt"],
  ["payload", "receivedAt"],
  ["payload", "timestamp"],
  ["payload", "createdAt"],
  ["payload", "message", "timestamp"],
  ["payload", "message", "createdAt"],
  ["data", "receivedAt"],
  ["data", "timestamp"],
  ["data", "createdAt"],
  ["data", "message", "timestamp"],
  ["data", "message", "createdAt"],
];

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function getValueAtPath(payload: unknown, path: FieldPath): unknown {
  let current: unknown = payload;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function formatPath(path: FieldPath): string {
  return path.join(".");
}

function extractField(
  payload: unknown,
  candidatePaths: readonly FieldPath[]
): ExtractedField {
  for (const path of candidatePaths) {
    const value = normalizeText(getValueAtPath(payload, path));

    if (value != null) {
      return {
        value,
        path: formatPath(path),
      };
    }
  }

  return {
    value: null,
    path: null,
  };
}

function extractWebhookFields(payload: unknown): ExtractedWebhookFields {
  return {
    locationId: extractField(payload, LOCATION_ID_PATHS),
    contactId: extractField(payload, CONTACT_ID_PATHS),
    conversationId: extractField(payload, CONVERSATION_ID_PATHS),
    messageBody: extractField(payload, MESSAGE_BODY_PATHS),
    messageId: extractField(payload, MESSAGE_ID_PATHS),
    receivedAt: extractField(payload, RECEIVED_AT_PATHS),
  };
}

function serializeExtractedFields(fields: ExtractedWebhookFields): JsonObject {
  return {
    locationId: {
      value: fields.locationId.value,
      path: fields.locationId.path,
    },
    contactId: {
      value: fields.contactId.value,
      path: fields.contactId.path,
    },
    conversationId: {
      value: fields.conversationId.value,
      path: fields.conversationId.path,
    },
    messageBody: {
      value: fields.messageBody.value,
      path: fields.messageBody.path,
    },
    messageId: {
      value: fields.messageId.value,
      path: fields.messageId.path,
    },
    receivedAt: {
      value: fields.receivedAt.value,
      path: fields.receivedAt.path,
    },
  };
}

function buildWebhookDebugPayload(input: {
  rawBody: string;
  payload: unknown;
  extracted: ExtractedWebhookFields;
  observability: ObservabilityContext;
  reason: string;
  parseError?: string | null;
  conversationId?: string | null;
  errorType?: OperationalErrorType | null;
  error?: unknown;
}): JsonObject {
  return {
    source: WEBHOOK_SOURCE,
    observability: input.observability,
    reason: input.reason,
    rawBody: input.rawBody,
    rawPayload: toJsonValue(input.payload),
    extracted: serializeExtractedFields(input.extracted),
    conversationId: input.conversationId ?? null,
    parseError: input.parseError ?? null,
    errorType: input.errorType ?? null,
    error: input.error != null ? getOperationalErrorMessage(input.error) : null,
  };
}

async function parseWebhookRequest(req: Request): Promise<ParsedWebhookRequest> {
  const rawBody = await req.text();

  if (rawBody.trim().length === 0) {
    return {
      rawBody,
      payload: null,
      parseError: "Request body was empty.",
    };
  }

  try {
    return {
      rawBody,
      payload: JSON.parse(rawBody) as unknown,
      parseError: null,
    };
  } catch (error) {
    return {
      rawBody,
      payload: null,
      parseError:
        error instanceof Error ? error.message : "Failed to parse JSON body.",
    };
  }
}

function logWebhookReceipt(
  input: ParsedWebhookRequest,
  observability: ObservabilityContext
) {
  console.log("Received internal GHL webhook.", {
    eventType: INBOUND_RECEIVED_EVENT,
    requestId: observability.requestId,
    traceId: observability.traceId,
    source: WEBHOOK_SOURCE,
    rawBody: input.rawBody,
    parseError: input.parseError,
    payload: input.parseError == null ? toJsonValue(input.payload) : null,
  });
}

function buildAcceptedResponse(input: {
  accepted: boolean;
  message: string;
  observability: ObservabilityContext;
  conversationId?: string | null;
  inboundMessageId?: string | null;
  aiDraftMessageId?: string | null;
  errorType?: OperationalErrorType | null;
}) {
  const headers = applyObservabilityHeaders(new Headers(), input.observability);

  return NextResponse.json(
    {
      success: true,
      accepted: input.accepted,
      message: input.message,
      requestId: input.observability.requestId,
      traceId: input.observability.traceId,
      errorType: input.errorType ?? null,
      conversationId: input.conversationId ?? null,
      inboundMessageId: input.inboundMessageId ?? null,
      aiDraftMessageId: input.aiDraftMessageId ?? null,
    },
    { status: 200, headers }
  );
}

async function recordAuditLogSafely(input: Parameters<typeof insertAuditLog>[0]) {
  try {
    await insertAuditLog(input);
  } catch (error) {
    console.error("Failed to persist GHL webhook audit log.", {
      source: WEBHOOK_SOURCE,
      tenantId: input.tenantId,
      eventType: input.eventType,
      requestId: input.requestId,
      traceId: input.traceId,
      errorType: input.errorType,
      error,
    });
  }
}

function shouldResolveConversation(fields: ExtractedWebhookFields): boolean {
  return (
    fields.messageBody.value != null ||
    fields.contactId.value != null ||
    fields.conversationId.value != null
  );
}

export async function POST(req: Request) {
  const observability = createObservabilityContextFromHeaders(req.headers);
  const parsedRequest = await parseWebhookRequest(req);
  const extracted = extractWebhookFields(parsedRequest.payload);

  logWebhookReceipt(parsedRequest, observability);

  if (parsedRequest.parseError != null) {
    console.warn("Ignoring internal GHL webhook with invalid JSON.", {
      source: WEBHOOK_SOURCE,
      eventType: INBOUND_RECEIVED_EVENT,
      requestId: observability.requestId,
      traceId: observability.traceId,
      errorType: "validation_error",
      rawBody: parsedRequest.rawBody,
      parseError: parsedRequest.parseError,
    });

    return buildAcceptedResponse({
      accepted: false,
      message: "Webhook received but JSON could not be parsed.",
      observability,
      errorType: "validation_error",
    });
  }

  let tenantId: string | null = null;
  let conversationId: string | null = null;
  let orchestrationStarted = false;

  try {
    const tenant =
      extracted.locationId.value != null
        ? await getTenantByGhlLocationId({
            ghlLocationId: extracted.locationId.value,
          })
        : null;

    if (tenant == null) {
      console.warn("Ignoring internal GHL webhook without a resolved tenant.", {
        source: WEBHOOK_SOURCE,
        eventType: INBOUND_RECEIVED_EVENT,
        requestId: observability.requestId,
        traceId: observability.traceId,
        locationId: extracted.locationId.value,
        debug: buildWebhookDebugPayload({
          rawBody: parsedRequest.rawBody,
          payload: parsedRequest.payload,
          extracted,
          observability,
          reason: "tenant_unresolved",
        }),
      });

      return buildAcceptedResponse({
        accepted: false,
        message:
          "Webhook received but no tenant could be resolved from the payload.",
        observability,
      });
    }

    tenantId = tenant.id;

    if (shouldResolveConversation(extracted)) {
      const conversation = await findOrCreateConversation({
        tenantId,
        ghlContactId: extracted.contactId.value,
        ghlConversationId: extracted.conversationId.value,
      });

      conversationId = conversation.id;
    }

    await recordAuditLogSafely({
      tenantId,
      eventType: INBOUND_RECEIVED_EVENT,
      requestId: observability.requestId,
      traceId: observability.traceId,
      status: extracted.messageBody.value == null ? "rejected" : "accepted",
      errorType:
        extracted.messageBody.value == null ? "validation_error" : null,
      payload: buildWebhookDebugPayload({
        rawBody: parsedRequest.rawBody,
        payload: parsedRequest.payload,
        extracted,
        observability,
        reason:
          extracted.messageBody.value == null
            ? "message_body_missing"
            : "accepted",
        conversationId,
        errorType:
          extracted.messageBody.value == null ? "validation_error" : null,
      }),
    });

    if (extracted.messageBody.value == null) {
      return buildAcceptedResponse({
        accepted: false,
        message:
          "Webhook received, but no inbound message body was available to route.",
        observability,
        errorType: "validation_error",
        conversationId,
      });
    }

    orchestrationStarted = true;

    const result = await orchestrateConversationTurn({
      tenantId,
      venue: {
        id: tenantId,
        venueName: tenant.name,
      },
      conversation: {
        id: conversationId ?? undefined,
        ghlContactId: extracted.contactId.value,
        ghlConversationId: extracted.conversationId.value,
      },
      inbound: {
        content: extracted.messageBody.value,
        source: WEBHOOK_SOURCE,
        role: "user",
        ghlMessageId: extracted.messageId.value,
        receivedAt: extracted.receivedAt.value ?? undefined,
        rawPayload: toJsonValue(parsedRequest.payload),
        metadata: {
          webhook: {
            rawBody: parsedRequest.rawBody,
            extracted: serializeExtractedFields(extracted),
          },
        },
      },
      observability,
    });

    return buildAcceptedResponse({
      accepted: true,
      message: "Webhook processed through the internal orchestration loop.",
      observability,
      conversationId: result.conversation.id,
      inboundMessageId: result.inboundMessage.id,
      aiDraftMessageId: result.aiDraftMessage.id,
    });
  } catch (error) {
    const errorType = classifyOperationalError(error);

    if (!orchestrationStarted && tenantId != null) {
      await recordAuditLogSafely({
        tenantId,
        eventType: ORCHESTRATION_HALTED_EVENT,
        requestId: observability.requestId,
        traceId: observability.traceId,
        status: errorType === "idempotency_drop" ? "dropped" : "failed",
        errorType,
        payload: buildWebhookDebugPayload({
          rawBody: parsedRequest.rawBody,
          payload: parsedRequest.payload,
          extracted,
          observability,
          reason: "pre_orchestration_failure",
          conversationId,
          errorType,
          error,
        }),
      });
    }

    console.error("Internal GHL webhook processing failed.", {
      source: WEBHOOK_SOURCE,
      tenantId,
      conversationId,
      requestId: observability.requestId,
      traceId: observability.traceId,
      errorType,
      error,
    });

    return buildAcceptedResponse({
      accepted: errorType === "idempotency_drop",
      message:
        errorType === "idempotency_drop"
          ? "Duplicate webhook message ignored because it was already processed."
          : "Webhook received, but internal processing failed.",
      observability,
      errorType,
      conversationId,
    });
  }
}
