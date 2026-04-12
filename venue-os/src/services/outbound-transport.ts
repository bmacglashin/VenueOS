import "server-only";

import {
  dispatchOutboundTransportCore,
  type DispatchOutboundTransportInput,
  type OutboundTransportDispatchResult,
} from "@/src/services/outbound-transport-core";

export type {
  DispatchOutboundTransportInput,
  OutboundTransportDispatchResult,
} from "@/src/services/outbound-transport-core";

export async function dispatchOutboundTransport(
  input: DispatchOutboundTransportInput
): Promise<OutboundTransportDispatchResult> {
  return dispatchOutboundTransportCore(input, {
    env: process.env,
    locationId: process.env.GHL_LOCATION_ID?.trim() || null,
  });
}
