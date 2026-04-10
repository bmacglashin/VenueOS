import "server-only";

import type { Database, Json } from "@/src/lib/db/supabase";
import { createSupabaseAdminClient } from "@/src/lib/db/admin";

type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];

export interface InsertAuditLogInput {
  tenantId: string;
  eventType: string;
  payload?: Json;
  status?: string;
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
      payload: input.payload ?? {},
      status: input.status ?? "recorded",
    })
    .select("*")
    .single();

  if (result.error != null || result.data == null) {
    throw new Error(
      `Failed to insert audit log: ${result.error?.message ?? "no data returned"}`
    );
  }

  return result.data;
}
