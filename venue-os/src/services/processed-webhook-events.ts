import "server-only";

import type { Database, Json } from "@/src/lib/db/supabase";
import { createSupabaseAdminClient } from "@/src/lib/db/admin";
import { DatabaseError } from "@/src/lib/observability";

type ProcessedWebhookEvent =
  Database["public"]["Tables"]["processed_webhook_events"]["Row"];

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

async function getProcessedWebhookEventByKey(input: {
  source: string;
  idempotencyKey: string;
}): Promise<ProcessedWebhookEvent | null> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("processed_webhook_events")
    .select("*")
    .eq("source", input.source)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch processed webhook event: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export interface ClaimProcessedWebhookEventInput {
  source: string;
  idempotencyKey: string;
  tenantId?: string | null;
  upstreamEventId?: string | null;
  upstreamMessageId?: string | null;
  requestId: string;
  traceId: string;
  payload?: Json;
}

export type ClaimProcessedWebhookEventResult =
  | {
      claimed: true;
      record: ProcessedWebhookEvent;
    }
  | {
      claimed: false;
      record: ProcessedWebhookEvent | null;
    };

export async function claimProcessedWebhookEvent(
  input: ClaimProcessedWebhookEventInput
): Promise<ClaimProcessedWebhookEventResult> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("processed_webhook_events")
    .insert({
      source: input.source,
      idempotency_key: input.idempotencyKey,
      tenant_id: input.tenantId ?? null,
      status: "processing",
      upstream_event_id: input.upstreamEventId ?? null,
      upstream_message_id: input.upstreamMessageId ?? null,
      request_id: input.requestId,
      trace_id: input.traceId,
      payload: input.payload ?? {},
      response_payload: {},
    })
    .select("*")
    .single();

  if (result.error == null && result.data != null) {
    return {
      claimed: true,
      record: result.data,
    };
  }

  if (
    result.error?.code === "23505" &&
    result.error.message.includes(
      "processed_webhook_events_source_idempotency_key_key"
    )
  ) {
    return {
      claimed: false,
      record: await getProcessedWebhookEventByKey(input),
    };
  }

  throw new DatabaseError(
    `Failed to claim processed webhook event: ${result.error?.message ?? "no data returned"}`,
    {
      cause: result.error,
    }
  );
}

export interface MarkProcessedWebhookEventInput {
  source: string;
  idempotencyKey: string;
  tenantId?: string | null;
  requestId?: string;
  traceId?: string;
  payload?: Json;
  responsePayload?: Json;
}

export async function markProcessedWebhookEvent(
  input: MarkProcessedWebhookEventInput
): Promise<ProcessedWebhookEvent> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("processed_webhook_events")
    .update({
      tenant_id: input.tenantId ?? null,
      status: "processed",
      request_id: input.requestId,
      trace_id: input.traceId,
      payload: input.payload !== undefined ? toJsonValue(input.payload) : undefined,
      response_payload:
        input.responsePayload !== undefined
          ? toJsonValue(input.responsePayload)
          : undefined,
    })
    .eq("source", input.source)
    .eq("idempotency_key", input.idempotencyKey)
    .select("*")
    .single();

  if (result.error != null || result.data == null) {
    throw new DatabaseError(
      `Failed to mark processed webhook event: ${result.error?.message ?? "no data returned"}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export interface ReleaseProcessedWebhookEventClaimInput {
  source: string;
  idempotencyKey: string;
}

export async function releaseProcessedWebhookEventClaim(
  input: ReleaseProcessedWebhookEventClaimInput
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("processed_webhook_events")
    .delete()
    .eq("source", input.source)
    .eq("idempotency_key", input.idempotencyKey)
    .eq("status", "processing");

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to release processed webhook event claim: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }
}
