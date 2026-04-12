import type { ObservabilityContext } from "@/src/lib/observability";
import { createObservabilityContext } from "@/src/lib/observability";
import type {
  OutboundDeliveryDecision,
  ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import { executeGhlWrite } from "@/src/services/ghl-execution";
import type { ResponsePolicyEvaluation } from "@/src/services/response-policy";

export interface DispatchOutboundTransportInput {
  tenantId: string;
  conversationId: string;
  outboundMessageId: string;
  content: string;
  observability: ObservabilityContext;
  policy: ResponsePolicyEvaluation;
  resolvedOutboundMode: ResolvedOutboundMode;
  outboundDecision: OutboundDeliveryDecision;
}

export interface OutboundTransportDispatchResult {
  attempted: boolean;
  outcome: "blocked" | "dry_run" | "skipped";
  provider: "ghl-shadow" | "pending_live_wiring";
  detail: string;
  dispatchedAt: string;
  observability: ObservabilityContext;
}

export interface DispatchOutboundTransportOptions {
  env?: NodeJS.ProcessEnv;
  locationId?: string | null;
}

function resolveLocationId(options: DispatchOutboundTransportOptions): string | null {
  const explicitLocationId = options.locationId?.trim();

  if (explicitLocationId != null && explicitLocationId.length > 0) {
    return explicitLocationId;
  }

  const envLocationId = options.env?.GHL_LOCATION_ID?.trim();

  return envLocationId != null && envLocationId.length > 0
    ? envLocationId
    : null;
}

export async function dispatchOutboundTransportCore(
  input: DispatchOutboundTransportInput,
  options: DispatchOutboundTransportOptions = {}
): Promise<OutboundTransportDispatchResult> {
  const observability = createObservabilityContext(input.observability);
  const operation = {
    entity: "outboundMessage",
    action: "dispatch",
    locationId: resolveLocationId(options),
    externalId: null,
    payload: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      outboundMessageId: input.outboundMessageId,
      content: input.content,
      policyDecision: input.policy.decision,
      resolvedOutboundMode: input.resolvedOutboundMode.mode,
      outboundAction: input.outboundDecision.action,
    },
  } as const;

  const execution = await executeGhlWrite({
    operation,
    observability,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    outboundMessageId: input.outboundMessageId,
    env: options.env,
    executeLive: async () => ({
      provider: "pending_live_wiring" as const,
      detail:
        "GHL live execution passed the guard, but the provider write path remains deferred until Shift 13.",
    }),
  });

  if (execution.decision === "blocked") {
    return {
      attempted: false,
      outcome: "blocked",
      provider: "ghl-shadow",
      detail:
        execution.reason === "mode_disabled"
          ? "Blocked because GHL_EXECUTION_MODE=disabled."
          : "Blocked because GHL_WRITE_KILL_SWITCH is enabled.",
      dispatchedAt: execution.loggedAt,
      observability,
    };
  }

  if (execution.decision === "dry_run") {
    return {
      attempted: false,
      outcome: "dry_run",
      provider: "ghl-shadow",
      detail:
        "Shadowed the outbound GHL dispatch in dry-run mode without sending a live write.",
      dispatchedAt: execution.loggedAt,
      observability,
    };
  }

  return {
    attempted: true,
    outcome: "skipped",
    provider: execution.result.provider,
    detail: execution.result.detail,
    dispatchedAt: execution.loggedAt,
    observability,
  };
}
