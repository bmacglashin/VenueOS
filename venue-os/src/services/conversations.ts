import "server-only";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";

import type { Database } from "@/src/lib/db/supabase";
import { DatabaseError } from "@/src/lib/observability";
import { createSupabaseAdminClient } from "@/src/lib/db/admin";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

export interface FindOrCreateTenantInput {
  slug: string;
  name: string;
  ghlLocationId?: string | null;
}

export interface GetTenantByGhlLocationIdInput {
  ghlLocationId: string;
}

export interface FindOrCreateConversationInput {
  tenantId: string;
  ghlContactId?: string | null;
  ghlConversationId?: string | null;
  status?: string;
}

export interface ListConversationsInput {
  tenantId: string;
  limit?: number;
}

export interface ListTenantsInput {
  limit?: number;
}

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: Message[];
}

function mustData<T>(result: PostgrestSingleResponse<T>, context: string): T {
  if (result.error != null) {
    throw new DatabaseError(`${context}: ${result.error.message}`, {
      cause: result.error,
    });
  }

  if (result.data == null) {
    throw new DatabaseError(`${context}: no data returned`);
  }

  return result.data;
}

export async function findOrCreateTenant(
  input: FindOrCreateTenantInput
): Promise<Tenant> {
  const supabase = createSupabaseAdminClient();

  const lookup = await supabase
    .from("venue_tenants")
    .select("*")
    .eq("slug", input.slug)
    .maybeSingle();

  if (lookup.error != null) {
    throw new DatabaseError(
      `Failed to lookup tenant by slug: ${lookup.error.message}`,
      {
        cause: lookup.error,
      }
    );
  }

  if (lookup.data != null) {
    return lookup.data;
  }

  const created = await supabase
    .from("venue_tenants")
    .insert({
      slug: input.slug,
      name: input.name,
      ghl_location_id: input.ghlLocationId ?? null,
    })
    .select("*")
    .single();

  return mustData(created, "Failed to create tenant");
}

export async function getTenantByGhlLocationId(
  input: GetTenantByGhlLocationIdInput
): Promise<Tenant | null> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("venue_tenants")
    .select("*")
    .eq("ghl_location_id", input.ghlLocationId)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to lookup tenant by GHL location id: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function listTenants(
  input: ListTenantsInput = {}
): Promise<Tenant[]> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("venue_tenants")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(input.limit ?? 25);

  if (result.error != null) {
    throw new DatabaseError(`Failed to list tenants: ${result.error.message}`, {
      cause: result.error,
    });
  }

  return result.data;
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("venue_tenants")
    .select("*")
    .eq("id", tenantId)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch tenant ${tenantId}: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function findOrCreateConversation(
  input: FindOrCreateConversationInput
): Promise<Conversation> {
  const supabase = createSupabaseAdminClient();

  if (input.ghlConversationId != null) {
    const byGhlConversationId = await supabase
      .from("conversations")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("ghl_conversation_id", input.ghlConversationId)
      .maybeSingle();

    if (byGhlConversationId.error != null) {
      throw new DatabaseError(
        `Failed to lookup conversation by GHL conversation id: ${byGhlConversationId.error.message}`,
        {
          cause: byGhlConversationId.error,
        }
      );
    }

    if (byGhlConversationId.data != null) {
      return byGhlConversationId.data;
    }
  }

  const created = await supabase
    .from("conversations")
    .insert({
      tenant_id: input.tenantId,
      ghl_contact_id: input.ghlContactId ?? null,
      ghl_conversation_id: input.ghlConversationId ?? null,
      status: input.status ?? "open",
    })
    .select("*")
    .single();

  return mustData(created, "Failed to create conversation");
}

export async function listConversations(
  input: ListConversationsInput
): Promise<Conversation[]> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("conversations")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .order("updated_at", { ascending: false })
    .limit(input.limit ?? 50);

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to list conversations: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function getConversationById(
  conversationId: string
): Promise<Conversation | null> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch conversation ${conversationId}: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function getConversationWithMessages(
  conversationId: string
): Promise<ConversationWithMessages | null> {
  const supabase = createSupabaseAdminClient();

  const conversationResult = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationResult.error != null) {
    throw new DatabaseError(
      `Failed to fetch conversation ${conversationId}: ${conversationResult.error.message}`,
      {
        cause: conversationResult.error,
      }
    );
  }

  if (conversationResult.data == null) {
    return null;
  }

  const messagesResult = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (messagesResult.error != null) {
    throw new DatabaseError(
      `Failed to fetch messages for conversation ${conversationId}: ${messagesResult.error.message}`,
      {
        cause: messagesResult.error,
      }
    );
  }

  return {
    conversation: conversationResult.data,
    messages: messagesResult.data,
  };
}
