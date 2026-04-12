import type {
  GhlExecutionMode,
  GhlLiveEnv,
} from "@/src/lib/config/ghl-env";
import {
  getValidatedGhlExecutionControls,
  getValidatedGhlLiveEnv,
} from "@/src/lib/config/ghl-env";
import type { ObservabilityContext } from "@/src/lib/observability";

export interface GhlWriteOperation<TPayload = unknown> {
  entity: string;
  action: string;
  locationId: string | null;
  externalId: string | null;
  payload: TPayload;
}

export interface GhlExecutionLogger {
  info: (message: string, metadata?: unknown) => void;
  warn: (message: string, metadata?: unknown) => void;
}

export interface ExecuteGhlWriteInput<TPayload, TResult> {
  operation: GhlWriteOperation<TPayload>;
  observability: ObservabilityContext;
  tenantId: string;
  conversationId?: string;
  outboundMessageId?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  logger?: GhlExecutionLogger;
  executeLive: (env: GhlLiveEnv) => Promise<TResult>;
}

export interface GhlExecutionLogEntry<TPayload> {
  eventType: "ghl.write_blocked" | "ghl.write_dry_run" | "ghl.write_live";
  provider: "ghl-shadow";
  decision: "blocked" | "dry_run" | "live";
  reason:
    | "mode_disabled"
    | "kill_switch_enabled"
    | "dry_run_shadow"
    | "live_allowed";
  executionMode: GhlExecutionMode;
  killSwitchEnabled: boolean;
  requestId: string;
  traceId: string;
  tenantId: string;
  conversationId: string | null;
  outboundMessageId: string | null;
  loggedAt: string;
  operation: GhlWriteOperation<TPayload>;
}

export interface GhlWriteBlockedResult<TPayload> {
  decision: "blocked";
  reason: "mode_disabled" | "kill_switch_enabled";
  executionMode: GhlExecutionMode;
  killSwitchEnabled: boolean;
  loggedAt: string;
  operation: GhlWriteOperation<TPayload>;
}

export interface GhlWriteDryRunResult<TPayload> {
  decision: "dry_run";
  executionMode: GhlExecutionMode;
  killSwitchEnabled: boolean;
  loggedAt: string;
  operation: GhlWriteOperation<TPayload>;
}

export interface GhlWriteLiveResult<TPayload, TResult> {
  decision: "live";
  executionMode: GhlExecutionMode;
  killSwitchEnabled: boolean;
  loggedAt: string;
  operation: GhlWriteOperation<TPayload>;
  liveEnv: GhlLiveEnv;
  result: TResult;
}

export type GhlWriteExecutionResult<TPayload, TResult> =
  | GhlWriteBlockedResult<TPayload>
  | GhlWriteDryRunResult<TPayload>
  | GhlWriteLiveResult<TPayload, TResult>;

function createLogEntry<TPayload>(input: {
  eventType: GhlExecutionLogEntry<TPayload>["eventType"];
  decision: GhlExecutionLogEntry<TPayload>["decision"];
  reason: GhlExecutionLogEntry<TPayload>["reason"];
  operation: GhlWriteOperation<TPayload>;
  observability: ObservabilityContext;
  tenantId: string;
  conversationId?: string;
  outboundMessageId?: string;
  executionMode: GhlExecutionMode;
  killSwitchEnabled: boolean;
  now: Date;
}): GhlExecutionLogEntry<TPayload> {
  return {
    eventType: input.eventType,
    provider: "ghl-shadow",
    decision: input.decision,
    reason: input.reason,
    executionMode: input.executionMode,
    killSwitchEnabled: input.killSwitchEnabled,
    requestId: input.observability.requestId,
    traceId: input.observability.traceId,
    tenantId: input.tenantId,
    conversationId: input.conversationId ?? null,
    outboundMessageId: input.outboundMessageId ?? null,
    loggedAt: input.now.toISOString(),
    operation: input.operation,
  };
}

export async function executeGhlWrite<TPayload, TResult>(
  input: ExecuteGhlWriteInput<TPayload, TResult>
): Promise<GhlWriteExecutionResult<TPayload, TResult>> {
  const envSource = input.env ?? process.env;
  const now = input.now ?? new Date();
  const logger = input.logger ?? console;
  const controls = getValidatedGhlExecutionControls(envSource);

  if (controls.mode === "disabled") {
    const entry = createLogEntry({
      eventType: "ghl.write_blocked",
      decision: "blocked",
      reason: "mode_disabled",
      operation: input.operation,
      observability: input.observability,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      outboundMessageId: input.outboundMessageId,
      executionMode: controls.mode,
      killSwitchEnabled: controls.killSwitchEnabled,
      now,
    });

    logger.warn("Blocked GHL write because GHL_EXECUTION_MODE=disabled.", entry);

    return {
      decision: "blocked",
      reason: "mode_disabled",
      executionMode: controls.mode,
      killSwitchEnabled: controls.killSwitchEnabled,
      loggedAt: entry.loggedAt,
      operation: input.operation,
    };
  }

  if (controls.mode === "dry_run") {
    const entry = createLogEntry({
      eventType: "ghl.write_dry_run",
      decision: "dry_run",
      reason: "dry_run_shadow",
      operation: input.operation,
      observability: input.observability,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      outboundMessageId: input.outboundMessageId,
      executionMode: controls.mode,
      killSwitchEnabled: controls.killSwitchEnabled,
      now,
    });

    logger.info("Shadowed GHL write in dry-run mode.", entry);

    return {
      decision: "dry_run",
      executionMode: controls.mode,
      killSwitchEnabled: controls.killSwitchEnabled,
      loggedAt: entry.loggedAt,
      operation: input.operation,
    };
  }

  if (controls.killSwitchEnabled) {
    const entry = createLogEntry({
      eventType: "ghl.write_blocked",
      decision: "blocked",
      reason: "kill_switch_enabled",
      operation: input.operation,
      observability: input.observability,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      outboundMessageId: input.outboundMessageId,
      executionMode: controls.mode,
      killSwitchEnabled: controls.killSwitchEnabled,
      now,
    });

    logger.warn(
      "Blocked GHL write because GHL_WRITE_KILL_SWITCH is enabled.",
      entry
    );

    return {
      decision: "blocked",
      reason: "kill_switch_enabled",
      executionMode: controls.mode,
      killSwitchEnabled: controls.killSwitchEnabled,
      loggedAt: entry.loggedAt,
      operation: input.operation,
    };
  }

  const liveEnv = getValidatedGhlLiveEnv(envSource);
  const entry = createLogEntry({
    eventType: "ghl.write_live",
    decision: "live",
    reason: "live_allowed",
    operation: input.operation,
    observability: input.observability,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    outboundMessageId: input.outboundMessageId,
    executionMode: controls.mode,
    killSwitchEnabled: controls.killSwitchEnabled,
    now,
  });

  logger.info("Executing live GHL write.", {
    ...entry,
    baseUrl: liveEnv.GHL_BASE_URL,
  });

  const result = await input.executeLive(liveEnv);

  return {
    decision: "live",
    executionMode: controls.mode,
    killSwitchEnabled: controls.killSwitchEnabled,
    loggedAt: entry.loggedAt,
    operation: input.operation,
    liveEnv,
    result,
  };
}
