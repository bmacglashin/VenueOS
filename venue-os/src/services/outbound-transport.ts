import "server-only";

import type {
  OutboundDeliveryDecision,
  ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import type { ResponsePolicyEvaluation } from "@/src/services/response-policy";

export interface DispatchOutboundTransportInput {
  tenantId: string;
  conversationId: string;
  outboundMessageId: string;
  content: string;
  policy: ResponsePolicyEvaluation;
  resolvedOutboundMode: ResolvedOutboundMode;
  outboundDecision: OutboundDeliveryDecision;
}

export interface OutboundTransportDispatchResult {
  attempted: boolean;
  outcome: "skipped";
  provider: "pending_live_wiring";
  detail: string;
  dispatchedAt: string;
}

export async function dispatchOutboundTransport(
  input: DispatchOutboundTransportInput
): Promise<OutboundTransportDispatchResult> {
  void input;

  return {
    attempted: true,
    outcome: "skipped",
    provider: "pending_live_wiring",
    detail:
      "Outbound transport wiring remains deferred until the live GHL integration shift.",
    dispatchedAt: new Date().toISOString(),
  };
}
