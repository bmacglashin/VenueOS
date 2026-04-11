import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/src/lib/db/supabase";
import {
  ConfigError,
  DatabaseError,
  type StructuredEventName,
} from "@/src/lib/observability";

export interface SystemHealthCheck {
  ok: boolean;
  detail: string;
}

export interface SystemHealthStatus {
  live: true;
  ready: boolean;
  status: "ready" | "degraded";
  generatedAt: string;
  checks: {
    configuration: SystemHealthCheck & {
      missingRequired: string[];
      missingOptional: string[];
    };
    database: SystemHealthCheck;
  };
}

export interface OpsStatusCounters {
  inboundReceived: number;
  reviewQueued: number;
  outboundSent: number;
  outboundBlocked: number;
  outboundFailed: number;
  duplicateDropped: number;
}

export interface OpsStatus {
  generatedAt: string;
  counters: OpsStatusCounters;
  lastAuditLogAt: string | null;
}

export interface OpsStatusAccessResult {
  ok: boolean;
  reason: "authorized" | "missing_token_config" | "unauthorized";
}

const REQUIRED_ENV_VARS = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_MODEL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "GHL_API_KEY",
  "GHL_LOCATION_ID",
  "GHL_BASE_URL",
  "OUTBOUND_MODE",
] as const;

const OPTIONAL_ENV_VARS = ["OPS_STATUS_TOKEN"] as const;

const COUNTER_EVENT_TYPES = {
  inboundReceived: "inbound.received",
  reviewQueued: "review.queued",
  outboundSent: "outbound.sent",
  outboundBlocked: "outbound.blocked",
  outboundFailed: "outbound.failed",
  duplicateDropped: "idempotency.dropped",
} satisfies Record<keyof OpsStatusCounters, StructuredEventName>;

function readEnvValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value != null && value.length > 0 ? value : null;
}

function listMissingEnvVars() {
  return {
    missingRequired: REQUIRED_ENV_VARS.filter((name) => readEnvValue(name) == null),
    missingOptional: OPTIONAL_ENV_VARS.filter((name) => readEnvValue(name) == null),
  };
}

function createRuntimeSupabaseAdminClient() {
  const supabaseUrl = readEnvValue("SUPABASE_URL");
  const serviceRoleKey = readEnvValue("SUPABASE_SERVICE_ROLE_KEY");

  if (supabaseUrl == null || serviceRoleKey == null) {
    throw new ConfigError(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be configured for system status checks."
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function checkDatabaseReadiness(): Promise<SystemHealthCheck> {
  try {
    const supabase = createRuntimeSupabaseAdminClient();
    const result = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .limit(1);

    if (result.error != null) {
      return {
        ok: false,
        detail: `Supabase query failed: ${result.error.message}`,
      };
    }

    return {
      ok: true,
      detail: "Supabase responded to a lightweight audit log query.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to initialize Supabase.";

    return {
      ok: false,
      detail: message,
    };
  }
}

async function countAuditLogsByEventType(
  supabase: ReturnType<typeof createRuntimeSupabaseAdminClient>,
  eventType: StructuredEventName
): Promise<number> {
  const result = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", eventType);

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to count audit logs for ${eventType}: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.count ?? 0;
}

async function getLatestAuditLogTimestamp(
  supabase: ReturnType<typeof createRuntimeSupabaseAdminClient>
): Promise<string | null> {
  const result = await supabase
    .from("audit_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch latest audit log timestamp: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data?.created_at ?? null;
}

function readOpsStatusTokenFromHeaders(headers: Headers): string | null {
  const authorization = headers.get("authorization")?.trim();

  if (authorization != null && authorization.toLowerCase().startsWith("bearer ")) {
    const bearerToken = authorization.slice("bearer ".length).trim();

    if (bearerToken.length > 0) {
      return bearerToken;
    }
  }

  return readEnvValueFromHeader(headers, "x-ops-token");
}

function readEnvValueFromHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  return value != null && value.length > 0 ? value : null;
}

export function authorizeOpsStatusRequest(headers: Headers): OpsStatusAccessResult {
  const expectedToken = readEnvValue("OPS_STATUS_TOKEN");

  if (expectedToken == null) {
    return {
      ok: false,
      reason: "missing_token_config",
    };
  }

  const providedToken = readOpsStatusTokenFromHeaders(headers);

  return {
    ok: providedToken === expectedToken,
    reason: providedToken === expectedToken ? "authorized" : "unauthorized",
  };
}

export async function getSystemHealthStatus(
  now: Date = new Date()
): Promise<SystemHealthStatus> {
  const missing = listMissingEnvVars();
  const database = await checkDatabaseReadiness();
  const configuration: SystemHealthStatus["checks"]["configuration"] = {
    ok: missing.missingRequired.length === 0,
    detail:
      missing.missingRequired.length === 0
        ? "All required runtime environment variables are configured."
        : `Missing required environment variables: ${missing.missingRequired.join(", ")}`,
    missingRequired: missing.missingRequired,
    missingOptional: missing.missingOptional,
  };
  const ready = configuration.ok && database.ok;

  return {
    live: true,
    ready,
    status: ready ? "ready" : "degraded",
    generatedAt: now.toISOString(),
    checks: {
      configuration,
      database,
    },
  };
}

export async function getOpsStatus(now: Date = new Date()): Promise<OpsStatus> {
  const supabase = createRuntimeSupabaseAdminClient();
  const [
    inboundReceived,
    reviewQueued,
    outboundSent,
    outboundBlocked,
    outboundFailed,
    duplicateDropped,
    lastAuditLogAt,
  ] = await Promise.all([
    countAuditLogsByEventType(supabase, COUNTER_EVENT_TYPES.inboundReceived),
    countAuditLogsByEventType(supabase, COUNTER_EVENT_TYPES.reviewQueued),
    countAuditLogsByEventType(supabase, COUNTER_EVENT_TYPES.outboundSent),
    countAuditLogsByEventType(supabase, COUNTER_EVENT_TYPES.outboundBlocked),
    countAuditLogsByEventType(supabase, COUNTER_EVENT_TYPES.outboundFailed),
    countAuditLogsByEventType(supabase, COUNTER_EVENT_TYPES.duplicateDropped),
    getLatestAuditLogTimestamp(supabase),
  ]);

  return {
    generatedAt: now.toISOString(),
    counters: {
      inboundReceived,
      reviewQueued,
      outboundSent,
      outboundBlocked,
      outboundFailed,
      duplicateDropped,
    },
    lastAuditLogAt,
  };
}
