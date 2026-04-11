import "server-only";

import type { Database, Json } from "@/src/lib/db/supabase";
import {
  DatabaseError,
  IdempotencyDropError,
} from "@/src/lib/observability";
import { createSupabaseAdminClient } from "@/src/lib/db/admin";
import { getConversationByIdForTenant } from "@/src/services/conversations";
import type {
  ResponsePolicyDecision,
  ResponsePolicyReason,
} from "@/src/services/response-policy";

type Message = Database["public"]["Tables"]["messages"]["Row"];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export interface InsertMessageInput {
  conversationId: string;
  role: string;
  content: string;
  direction: MessageDirection;
  source: string;
  status?: string;
  ghlMessageId?: string | null;
  rawPayload?: Json;
  metadata?: Json;
  policyDecision?: ResponsePolicyDecision | null;
  policyReasons?: ResponsePolicyReason[];
  policyEvaluatedAt?: string | null;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export interface FetchRecentMessagesInput {
  conversationId: string;
  limit?: number;
}

export interface FetchRecentMessagesForTenantInput {
  tenantId: string;
  conversationId: string;
  limit?: number;
}

export interface FindMessageByGhlMessageIdInput {
  ghlMessageId: string;
}

export interface FindMessageByGhlMessageIdForTenantInput {
  tenantId: string;
  ghlMessageId: string;
}

export interface UpdateMessageInput {
  messageId: string;
  content?: string;
  status?: string;
  metadata?: Json;
  rawPayload?: Json;
  policyDecision?: ResponsePolicyDecision | null;
  policyReasons?: ResponsePolicyReason[];
  policyEvaluatedAt?: string | null;
}

export async function insertMessage(input: InsertMessageInput): Promise<Message> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      direction: input.direction,
      source: input.source,
      status: input.status ?? "recorded",
      ghl_message_id: input.ghlMessageId ?? null,
      raw_payload: input.rawPayload ?? {},
      metadata: input.metadata ?? {},
      policy_decision: input.policyDecision ?? null,
      policy_reasons: toJsonValue(input.policyReasons ?? []),
      policy_evaluated_at: input.policyEvaluatedAt ?? null,
    })
    .select("*")
    .single();

  if (result.error != null || result.data == null) {
    if (
      result.error?.code === "23505" &&
      result.error.message.includes("messages_ghl_message_id_key")
    ) {
      throw new IdempotencyDropError(
        `Message with GHL id ${input.ghlMessageId ?? "unknown"} was already recorded.`,
        {
          cause: result.error,
        }
      );
    }

    throw new DatabaseError(
      `Failed to insert message: ${result.error?.message ?? "no data returned"}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function insertInboundMessage(
  input: Omit<InsertMessageInput, "direction">
): Promise<Message> {
  return insertMessage({
    ...input,
    direction: "inbound",
  });
}

export async function insertOutboundMessage(
  input: Omit<InsertMessageInput, "direction">
): Promise<Message> {
  return insertMessage({
    ...input,
    direction: "outbound",
  });
}

export async function fetchRecentMessages(
  input: FetchRecentMessagesInput
): Promise<Message[]> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 20);

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch recent messages: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function fetchRecentMessagesForTenant(
  input: FetchRecentMessagesForTenantInput
): Promise<Message[]> {
  const conversation = await getConversationByIdForTenant({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });

  if (conversation == null) {
    return [];
  }

  return fetchRecentMessages({
    conversationId: conversation.id,
    limit: input.limit,
  });
}

export async function findMessageByGhlMessageId(
  input: FindMessageByGhlMessageIdInput
): Promise<Message | null> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("messages")
    .select("*")
    .eq("ghl_message_id", input.ghlMessageId)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch message by GHL message id: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function findMessageByGhlMessageIdForTenant(
  input: FindMessageByGhlMessageIdForTenantInput
): Promise<Message | null> {
  const message = await findMessageByGhlMessageId({
    ghlMessageId: input.ghlMessageId,
  });

  if (message == null) {
    return null;
  }

  const conversation = await getConversationByIdForTenant({
    tenantId: input.tenantId,
    conversationId: message.conversation_id,
  });

  return conversation == null ? null : message;
}

export async function listConversationMessages(
  conversationId: string
): Promise<Message[]> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to list messages for conversation ${conversationId}: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function listConversationMessagesForTenant(input: {
  tenantId: string;
  conversationId: string;
}): Promise<Message[]> {
  const conversation = await getConversationByIdForTenant({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });

  if (conversation == null) {
    return [];
  }

  return listConversationMessages(conversation.id);
}

export async function getMessageById(messageId: string): Promise<Message | null> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(`Failed to fetch message ${messageId}: ${result.error.message}`, {
      cause: result.error,
    });
  }

  return result.data;
}

export async function updateMessage(input: UpdateMessageInput): Promise<Message> {
  const supabase = createSupabaseAdminClient();
  const updatePayload: Database["public"]["Tables"]["messages"]["Update"] = {};

  if (input.content !== undefined) {
    updatePayload.content = input.content;
  }

  if (input.status !== undefined) {
    updatePayload.status = input.status;
  }

  if (input.metadata !== undefined) {
    updatePayload.metadata = input.metadata;
  }

  if (input.rawPayload !== undefined) {
    updatePayload.raw_payload = input.rawPayload;
  }

  if (input.policyDecision !== undefined) {
    updatePayload.policy_decision = input.policyDecision;
  }

  if (input.policyReasons !== undefined) {
    updatePayload.policy_reasons = toJsonValue(input.policyReasons);
  }

  if (input.policyEvaluatedAt !== undefined) {
    updatePayload.policy_evaluated_at = input.policyEvaluatedAt;
  }

  const result = await supabase
    .from("messages")
    .update(updatePayload)
    .eq("id", input.messageId)
    .select("*")
    .single();

  if (result.error != null || result.data == null) {
    throw new DatabaseError(
      `Failed to update message ${input.messageId}: ${result.error?.message ?? "no data returned"}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}
