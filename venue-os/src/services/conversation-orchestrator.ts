import "server-only";

import { z } from "zod";

import {
  routeInboundMessage,
  type InboundRouteClassification,
  type RouteInboundMessageMetadata,
} from "@/src/lib/llm/router";
import type { Database, Json } from "@/src/lib/db/supabase";
import type { VenueMessageRole, VenueRecentMessage } from "@/src/services/ai";
import {
  findOrCreateConversation,
  getConversationById,
} from "@/src/services/conversations";
import { insertAuditLog } from "@/src/services/audit-logs";
import {
  fetchRecentMessages,
  insertInboundMessage,
  insertOutboundMessage,
} from "@/src/services/messages";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

const SESSION_MEMORY_LIMIT = 5;
const TURN_PERSISTED_EVENT = "conversation_turn.persisted";
const TURN_FAILED_EVENT = "conversation_turn.failed";
const AI_DRAFT_SOURCE = "venue_os_ai_draft";

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

async function resolveConversation(
  input: ConversationTurnRequest
): Promise<Conversation> {
  if (input.conversation.id != null) {
    const conversation = await getConversationById(input.conversation.id);

    if (conversation == null) {
      throw new Error(
        `Conversation ${input.conversation.id} was not found for orchestration.`
      );
    }

    if (conversation.tenant_id !== input.tenantId) {
      throw new Error(
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
}): Json {
  return {
    kind: "ai_draft",
    route: input.classification,
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
  };
}

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
    await insertAuditLog({
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

export async function orchestrateConversationTurn(
  input: ConversationTurnRequest
): Promise<OrchestrateConversationTurnResult> {
  let stage = "resolve_conversation";
  let conversation: Conversation | undefined;

  try {
    conversation = await resolveConversation(input);

    stage = "fetch_recent_messages";
    const recentMessages = await fetchRecentMessages({
      conversationId: conversation.id,
      limit: SESSION_MEMORY_LIMIT,
    });
    const routerRecentMessages = toRouterRecentMessages(recentMessages);

    stage = "route_inbound_message";
    const routedTurn = await routeInboundMessage({
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
    const inboundMessage = await insertInboundMessage({
      conversationId: conversation.id,
      role: input.inbound.role ?? "user",
      content: input.inbound.content,
      source: input.inbound.source,
      ghlMessageId: input.inbound.ghlMessageId ?? null,
      rawPayload: input.inbound.rawPayload ?? {},
      metadata: buildInboundMessageMetadata(input, recentMessages),
    });

    stage = "persist_ai_draft";
    const aiDraftMessage = await insertOutboundMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: routedTurn.aiReply,
      source: AI_DRAFT_SOURCE,
      status: "draft",
      metadata: buildAiDraftMetadata({
        classification: routedTurn.classification,
        metadata: routedTurn.metadata,
        recentMessages,
        inboundMessageId: inboundMessage.id,
        conversationId: conversation.id,
      }),
    });

    stage = "persist_audit_log";
    await insertAuditLog({
      tenantId: input.tenantId,
      eventType: TURN_PERSISTED_EVENT,
      status: "succeeded",
      payload: {
        conversationId: conversation.id,
        inboundMessageId: inboundMessage.id,
        aiDraftMessageId: aiDraftMessage.id,
        route: routedTurn.classification,
        replySource: routedTurn.metadata.replySource,
        source: input.inbound.source,
        sessionMemory: {
          strategy: "last_messages",
          limit: SESSION_MEMORY_LIMIT,
          recentMessageCount: recentMessages.length,
          recentMessageIds: recentMessages.map((message) => message.id),
        },
      },
    });

    return {
      conversation,
      recentMessages,
      inboundMessage,
      aiDraftMessage,
      classification: routedTurn.classification,
      aiReply: routedTurn.aiReply,
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
}
