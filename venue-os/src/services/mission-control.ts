import "server-only";

import type { Database, Json } from "@/src/lib/db/supabase";
import {
  listAuditLogs,
  type ListAuditLogsInput,
} from "@/src/services/audit-logs";
import { getLatestDraftVersionMessage } from "@/src/services/draft-history";
import type {
  OutboundAction,
  ResolvedOutboundMode,
} from "@/src/services/outbound-control";
import { determineOutboundDelivery } from "@/src/services/outbound-control";
import {
  type OrchestrateConversationTurnResult,
} from "@/src/services/conversation-orchestrator";
import {
  findOrCreateTenant,
  getConversationById,
  getConversationWithMessages,
  getTenantById,
  listConversations,
  listTenants,
} from "@/src/services/conversations";
import { fetchRecentMessages } from "@/src/services/messages";
import { resolveOutboundModeForTenant } from "@/src/services/outbound-settings";
import {
  RESPONSE_POLICY_DECISIONS,
  type ResponsePolicyDecision,
} from "@/src/services/response-policy";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];
type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];

const SANDBOX_SOURCE = "mission_control_sandbox";
const SANDBOX_TENANT_SLUG = "mission-control-sandbox";
const SANDBOX_TENANT_NAME = "Mission Control Sandbox";
const CONVERSATION_LIST_LIMIT = 25;
const RECENT_MESSAGE_LIMIT = 6;
const AUDIT_LOG_LIMIT = 12;

export interface MissionControlConversationSummary {
  conversation: Conversation;
  latestMessage: Message | null;
  latestAiDraftMessage: Message | null;
  lastActivityAt: string;
  lastPreview: string | null;
  routeCategory: string | null;
  policyDecision: string | null;
  outboundAction: OutboundAction | null;
  policyReasonCodes: string[];
  requiresHumanReview: boolean;
}

export interface MissionControlSummaryStats {
  conversationCount: number;
  aiDraftCount: number;
  humanReviewCount: number;
}

export interface MissionControlOverviewData {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  resolvedOutboundMode: ResolvedOutboundMode;
  conversations: MissionControlConversationSummary[];
  stats: MissionControlSummaryStats;
}

export interface MissionControlConversationDetail {
  tenant: Tenant;
  resolvedOutboundMode: ResolvedOutboundMode;
  conversations: MissionControlConversationSummary[];
  stats: MissionControlSummaryStats;
  conversation: Conversation;
  messages: Message[];
  latestInboundMessage: Message | null;
  latestAiDraftMessage: Message | null;
  draftRouteCategory: string | null;
  draftPolicyDecision: string | null;
  draftOutboundAction: OutboundAction | null;
  draftPolicyReasonCodes: string[];
  draftRequiresHumanReview: boolean;
  auditLogs: AuditLog[];
}

export interface MissionControlSandboxData {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  resolvedOutboundMode: ResolvedOutboundMode;
  conversations: MissionControlConversationSummary[];
  selectedConversation: MissionControlConversationDetail | null;
  willCreateTenantOnFirstRun: boolean;
}

export interface RunMissionControlSandboxTurnInput {
  tenantId?: string;
  conversationId?: string;
  message: string;
}

function byCreatedAtAscending(
  left: { created_at: string },
  right: { created_at: string }
) {
  return left.created_at.localeCompare(right.created_at);
}

function isJsonObject(
  value: Json | null | undefined
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(
  value: Json | null | undefined
): { [key: string]: Json | undefined } | null {
  return isJsonObject(value) ? value : null;
}

function readString(value: Json | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: Json | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readArray(value: Json | null | undefined): Json[] | null {
  return Array.isArray(value) ? value : null;
}

function getLatestInboundMessage(messages: readonly Message[]): Message | null {
  return [...messages]
    .filter((message) => message.direction === "inbound")
    .sort(byCreatedAtAscending)
    .at(-1) ?? null;
}

function getLatestAiDraftMessage(messages: readonly Message[]): Message | null {
  return getLatestDraftVersionMessage(messages);
}

function getDraftRouteCategory(message: Message | null): string | null {
  const metadata = readJsonObject(message?.metadata);
  const route = readJsonObject(metadata?.route);
  return readString(route?.category);
}

function getDraftPolicyDecision(message: Message | null): string | null {
  if (message?.policy_decision != null) {
    return readString(message.policy_decision);
  }

  const metadata = readJsonObject(message?.metadata);
  const responsePolicy = readJsonObject(metadata?.responsePolicy);
  return readString(responsePolicy?.decision);
}

function getDraftPolicyReasonCodes(message: Message | null): string[] {
  const storedReasons = readArray(message?.policy_reasons);

  if (storedReasons != null) {
    const codes = storedReasons.flatMap((reason) => {
      const reasonObject = readJsonObject(reason);
      const code = readString(reasonObject?.code);
      return code == null ? [] : [code];
    });

    if (codes.length > 0) {
      return codes;
    }
  }

  const metadata = readJsonObject(message?.metadata);
  const responsePolicy = readJsonObject(metadata?.responsePolicy);
  const reasons = readArray(responsePolicy?.reasons) ?? [];

  return reasons.flatMap((reason) => {
    const reasonObject = readJsonObject(reason);
    const code = readString(reasonObject?.code);
    return code == null ? [] : [code];
  });
}

function isResponsePolicyDecision(
  value: string | null
): value is ResponsePolicyDecision {
  return (
    value != null &&
    RESPONSE_POLICY_DECISIONS.some((decision) => decision === value)
  );
}

function getDraftOutboundAction(
  message: Message | null,
  resolvedOutboundMode: ResolvedOutboundMode
): OutboundAction | null {
  const metadata = readJsonObject(message?.metadata);
  const outboundDelivery = readJsonObject(metadata?.outboundDelivery);
  const storedAction = readString(outboundDelivery?.action);

  if (
    storedAction === "proceed" ||
    storedAction === "queue" ||
    storedAction === "block"
  ) {
    return storedAction;
  }

  const policyDecision = getDraftPolicyDecision(message);

  if (!isResponsePolicyDecision(policyDecision)) {
    return null;
  }

  return determineOutboundDelivery({
    policyDecision,
    resolvedMode: resolvedOutboundMode,
  }).action;
}

function getDraftRequiresHumanReview(
  message: Message | null,
  resolvedOutboundMode: ResolvedOutboundMode
): boolean {
  const outboundAction = getDraftOutboundAction(message, resolvedOutboundMode);

  if (outboundAction != null) {
    return outboundAction === "queue";
  }

  const policyDecision = getDraftPolicyDecision(message);

  if (policyDecision === "needs_review" || policyDecision === "block_send") {
    return true;
  }

  if (policyDecision === "safe_to_send") {
    return false;
  }

  const metadata = readJsonObject(message?.metadata);
  const route = readJsonObject(metadata?.route);
  return readBoolean(route?.requiresHumanReview) ?? false;
}

function summarizePreview(message: Message | null): string | null {
  if (message == null) {
    return null;
  }

  const normalized = message.content.replace(/\s+/g, " ").trim();

  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137)}...`;
}

function buildConversationSummary(
  conversation: Conversation,
  recentMessages: readonly Message[],
  resolvedOutboundMode: ResolvedOutboundMode
): MissionControlConversationSummary {
  const orderedMessages = [...recentMessages].sort(byCreatedAtAscending);
  const latestMessage = orderedMessages.at(-1) ?? null;
  const latestAiDraftMessage = getLatestAiDraftMessage(orderedMessages);

  return {
    conversation,
    latestMessage,
    latestAiDraftMessage,
    lastActivityAt: latestMessage?.created_at ?? conversation.updated_at,
    lastPreview: summarizePreview(latestMessage),
    routeCategory: getDraftRouteCategory(latestAiDraftMessage),
    policyDecision: getDraftPolicyDecision(latestAiDraftMessage),
    outboundAction: getDraftOutboundAction(
      latestAiDraftMessage,
      resolvedOutboundMode
    ),
    policyReasonCodes: getDraftPolicyReasonCodes(latestAiDraftMessage),
    requiresHumanReview: getDraftRequiresHumanReview(
      latestAiDraftMessage,
      resolvedOutboundMode
    ),
  };
}

async function listConversationSummariesForTenant(
  tenant: Tenant,
  limit = CONVERSATION_LIST_LIMIT
): Promise<MissionControlConversationSummary[]> {
  const resolvedOutboundMode = resolveOutboundModeForTenant(tenant);
  const conversations = await listConversations({
    tenantId: tenant.id,
    limit,
  });

  const summaries = await Promise.all(
    conversations.map(async (conversation) =>
      buildConversationSummary(
        conversation,
        await fetchRecentMessages({
          conversationId: conversation.id,
          limit: RECENT_MESSAGE_LIMIT,
        }),
        resolvedOutboundMode
      )
    )
  );

  return summaries.sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt)
  );
}

function buildSummaryStats(
  conversations: readonly MissionControlConversationSummary[]
): MissionControlSummaryStats {
  return {
    conversationCount: conversations.length,
    aiDraftCount: conversations.filter(
      (conversation) => conversation.latestAiDraftMessage != null
    ).length,
    humanReviewCount: conversations.filter(
      (conversation) => conversation.requiresHumanReview
    ).length,
  };
}

function resolveSelectedTenant(
  tenants: readonly Tenant[],
  tenantId?: string
): Tenant | null {
  if (tenantId != null) {
    const match = tenants.find((tenant) => tenant.id === tenantId);

    if (match != null) {
      return match;
    }
  }

  return tenants[0] ?? null;
}

async function listConversationAuditLogs(
  input: ListAuditLogsInput
): Promise<AuditLog[]> {
  try {
    return await listAuditLogs(input);
  } catch (error) {
    console.error("Mission Control could not filter audit logs by conversation.", {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      error,
    });

    return listAuditLogs({
      tenantId: input.tenantId,
      limit: input.limit,
    });
  }
}

export async function getMissionControlOverview(
  input: { tenantId?: string } = {}
): Promise<MissionControlOverviewData> {
  const tenants = await listTenants({
    limit: CONVERSATION_LIST_LIMIT,
  });
  const selectedTenant = resolveSelectedTenant(tenants, input.tenantId);
  const resolvedOutboundMode = resolveOutboundModeForTenant(selectedTenant);
  const conversations =
    selectedTenant == null
      ? []
      : await listConversationSummariesForTenant(selectedTenant);

  return {
    tenants,
    selectedTenant,
    resolvedOutboundMode,
    conversations,
    stats: buildSummaryStats(conversations),
  };
}

export async function getMissionControlConversationDetail(
  conversationId: string
): Promise<MissionControlConversationDetail | null> {
  const detail = await getConversationWithMessages(conversationId);

  if (detail == null) {
    return null;
  }

  const tenant = await getTenantById(detail.conversation.tenant_id);

  if (tenant == null) {
    throw new Error(
      `Conversation ${conversationId} is attached to a missing tenant ${detail.conversation.tenant_id}.`
    );
  }

  const [conversations, auditLogs] = await Promise.all([
    listConversationSummariesForTenant(tenant),
    listConversationAuditLogs({
      tenantId: tenant.id,
      conversationId,
      limit: AUDIT_LOG_LIMIT,
    }),
  ]);
  const resolvedOutboundMode = resolveOutboundModeForTenant(tenant);

  const latestInboundMessage = getLatestInboundMessage(detail.messages);
  const latestAiDraftMessage = getLatestAiDraftMessage(detail.messages);

  return {
    tenant,
    resolvedOutboundMode,
    conversations,
    stats: buildSummaryStats(conversations),
    conversation: detail.conversation,
    messages: detail.messages,
    latestInboundMessage,
    latestAiDraftMessage,
    draftRouteCategory: getDraftRouteCategory(latestAiDraftMessage),
    draftPolicyDecision: getDraftPolicyDecision(latestAiDraftMessage),
    draftOutboundAction: getDraftOutboundAction(
      latestAiDraftMessage,
      resolvedOutboundMode
    ),
    draftPolicyReasonCodes: getDraftPolicyReasonCodes(latestAiDraftMessage),
    draftRequiresHumanReview: getDraftRequiresHumanReview(
      latestAiDraftMessage,
      resolvedOutboundMode
    ),
    auditLogs,
  };
}

export async function getMissionControlSandboxData(
  input: { tenantId?: string; conversationId?: string } = {}
): Promise<MissionControlSandboxData> {
  const tenants = await listTenants({
    limit: CONVERSATION_LIST_LIMIT,
  });
  const selectedConversation =
    input.conversationId == null
      ? null
      : await getMissionControlConversationDetail(input.conversationId);
  const selectedTenant =
    selectedConversation?.tenant ??
    resolveSelectedTenant(tenants, input.tenantId);
  const selectedConversationMatchesTenant =
    selectedConversation != null &&
    selectedTenant != null &&
    selectedConversation.tenant.id === selectedTenant.id;
  const conversations =
    selectedConversationMatchesTenant
      ? selectedConversation.conversations
      : selectedTenant == null
        ? []
        : await listConversationSummariesForTenant(selectedTenant, 15);
  const resolvedOutboundMode =
    selectedConversation?.resolvedOutboundMode ??
    resolveOutboundModeForTenant(selectedTenant);

  return {
    tenants,
    selectedTenant,
    resolvedOutboundMode,
    conversations,
    selectedConversation,
    willCreateTenantOnFirstRun: tenants.length === 0 && selectedTenant == null,
  };
}

async function resolveSandboxTenant(
  input: RunMissionControlSandboxTurnInput
): Promise<Tenant> {
  if (input.conversationId != null) {
    const conversation = await getConversationById(input.conversationId);

    if (conversation == null) {
      throw new Error(
        `Sandbox conversation ${input.conversationId} was not found.`
      );
    }

    const tenant = await getTenantById(conversation.tenant_id);

    if (tenant == null) {
      throw new Error(
        `Sandbox conversation ${input.conversationId} belongs to a missing tenant ${conversation.tenant_id}.`
      );
    }

    return tenant;
  }

  if (input.tenantId != null) {
    const tenant = await getTenantById(input.tenantId);

    if (tenant != null) {
      return tenant;
    }
  }

  const [firstTenant] = await listTenants({
    limit: 1,
  });

  if (firstTenant != null) {
    return firstTenant;
  }

  return findOrCreateTenant({
    slug: SANDBOX_TENANT_SLUG,
    name: SANDBOX_TENANT_NAME,
  });
}

export async function runMissionControlSandboxTurn(
  input: RunMissionControlSandboxTurnInput
): Promise<OrchestrateConversationTurnResult> {
  const message = input.message.trim();

  if (message.length === 0) {
    throw new Error("Sandbox message is required.");
  }

  const tenant = await resolveSandboxTenant(input);
  const { orchestrateConversationTurn } = await import(
    "@/src/services/conversation-orchestrator"
  );

  return orchestrateConversationTurn({
    tenantId: tenant.id,
    venue: {
      id: tenant.id,
      venueName: tenant.name,
    },
    conversation:
      input.conversationId != null
        ? {
            id: input.conversationId,
          }
        : {},
    inbound: {
      content: message,
      source: SANDBOX_SOURCE,
      role: "user",
      receivedAt: new Date().toISOString(),
      rawPayload: {
        sandbox: {
          internal: true,
          tenantId: tenant.id,
          conversationId: input.conversationId ?? null,
        },
      },
      metadata: {
        sandbox: {
          internal: true,
          tool: "mission_control",
        },
      },
    },
  });
}
