import "server-only";

import type { Database } from "@/src/lib/db/supabase";
import { env } from "@/src/lib/config/env";
import { OUTBOUND_MODES, type OutboundMode } from "@/src/lib/config/outbound";
import {
  resolveOutboundMode,
  type ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import { getTenantById } from "@/src/services/conversations";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];

export type TenantOutboundSettings = Pick<
  Tenant,
  "id" | "name" | "outbound_mode_override"
>;

function normalizeOutboundMode(value: string | null | undefined): OutboundMode | null {
  if (value == null) {
    return null;
  }

  return OUTBOUND_MODES.find((mode) => mode === value) ?? null;
}

export function getGlobalOutboundMode(): OutboundMode {
  return env.OUTBOUND_MODE;
}

export function getTenantOutboundModeOverride(
  tenant: TenantOutboundSettings | null | undefined
): OutboundMode | null {
  return normalizeOutboundMode(tenant?.outbound_mode_override);
}

export function resolveOutboundModeForTenant(
  tenant: TenantOutboundSettings | null | undefined,
  options: { globalMode?: OutboundMode } = {}
): ResolvedOutboundMode {
  return resolveOutboundMode({
    globalMode: options.globalMode ?? getGlobalOutboundMode(),
    tenantOverride: getTenantOutboundModeOverride(tenant),
  });
}

export async function getResolvedOutboundModeForTenant(
  tenantId: string
): Promise<ResolvedOutboundMode> {
  const tenant = await getTenantById(tenantId);

  return resolveOutboundModeForTenant(tenant);
}
