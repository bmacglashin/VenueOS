import "server-only";

import type { Database, Json } from "@/src/lib/db/supabase";
import type {
  OperationalErrorType,
  StructuredEventName,
} from "@/src/lib/observability";
import { DatabaseError } from "@/src/lib/observability";
import { createSupabaseAdminClient } from "@/src/lib/db/admin";

type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];

export interface InsertAuditLogInput {
  tenantId: string;
  eventType: StructuredEventName;
  requestId: string;
  traceId: string;
  errorType?: OperationalErrorType | null;
  payload?: Json;
  status?: string;
}

export interface ListAuditLogsInput {
  tenantId: string;
  conversationId?: string;
  limit?: number;
}

export async function insertAuditLog(
  input: InsertAuditLogInput
): Promise<AuditLog> {
  const supabase = createSupabaseAdminClient();

  const result = await supabase
    .from("audit_logs")
    .insert({
      tenant_id: input.tenantId,
      event_type: input.eventType,
      request_id: input.requestId,
      trace_id: input.traceId,
      error_type: input.errorType ?? null,
      payload: input.payload ?? {},
      status: input.status ?? "recorded",
    })
    .select("*")
    .single();

  if (result.error != null || result.data == null) {
    throw new DatabaseError(
      `Failed to insert audit log: ${result.error?.message ?? "no data returned"}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function listAuditLogs(
  input: ListAuditLogsInput
): Promise<AuditLog[]> {
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("audit_logs")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 20);

  if (input.conversationId != null) {
    query = query.contains("payload", {
      conversationId: input.conversationId,
    });
  }

  const result = await query;

  if (result.error != null) {
    throw new DatabaseError(`Failed to list audit logs: ${result.error.message}`, {
      cause: result.error,
    });
  }

  return result.data;
}
