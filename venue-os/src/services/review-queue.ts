import "server-only";

import type { Database, Json } from "@/src/lib/db/supabase";
import { createSupabaseAdminClient } from "@/src/lib/db/admin";
import { listTenants } from "@/src/services/conversations";
import { resolveOutboundModeForTenant } from "@/src/services/outbound-settings";
import {
  REVIEW_QUEUE_CONFIDENCE_BANDS,
  filterReviewQueueItems,
  getReviewQueueConfidenceBand,
  type ReviewQueueConfidenceBand,
  type ReviewQueueFilters,
  type ReviewQueueItem,
  type ReviewQueuePolicyReason,
} from "@/src/services/review-queue-core";
import type { ResolvedOutboundMode } from "@/src/services/outbound-control";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

const AI_DRAFT_SOURCE = "venue_os_ai_draft";
const REVIEW_QUEUE_STATUS = "queued_for_review";
const REVIEW_QUEUE_LIMIT = 200;

export interface ReviewQueueFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface ReviewQueueConfidenceBandOption {
  value: ReviewQueueConfidenceBand;
  label: string;
  count: number;
}

export interface ReviewQueueStats {
  reviewCount: number;
  tenantCount: number;
  lowConfidenceCount: number;
}

export interface MissionControlReviewQueueData {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  resolvedOutboundMode: ResolvedOutboundMode | null;
  filters: ReviewQueueFilters;
  items: ReviewQueueItem[];
  totalCount: number;
  routes: ReviewQueueFilterOption[];
  statuses: ReviewQueueFilterOption[];
  confidenceBands: ReviewQueueConfidenceBandOption[];
  stats: ReviewQueueStats;
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

function readArray(value: Json | null | undefined): Json[] | null {
  return Array.isArray(value) ? value : null;
}

function readString(value: Json | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: Json | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeExcerpt(value: string | null): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177)}...`;
}

function readRoute(message: Message): string | null {
  const metadata = readJsonObject(message.metadata);
  const route = readJsonObject(metadata?.route);
  return readString(route?.category);
}

function readConfidence(message: Message): number | null {
  const metadata = readJsonObject(message.metadata);
  const route = readJsonObject(metadata?.route);
  return readNumber(route?.confidence);
}

function readInboundMessageId(message: Message): string | null {
  const metadata = readJsonObject(message.metadata);
  const router = readJsonObject(metadata?.router);
  const persistence = readJsonObject(router?.persistence);
  return readString(persistence?.inboundMessageId);
}

function readPolicyDecision(message: Message): string | null {
  if (message.policy_decision != null) {
    return readString(message.policy_decision);
  }

  const metadata = readJsonObject(message.metadata);
  const responsePolicy = readJsonObject(metadata?.responsePolicy);
  return readString(responsePolicy?.decision);
}

function readPolicyReasons(message: Message): ReviewQueuePolicyReason[] {
  const storedReasons = readArray(message.policy_reasons);

  if (storedReasons != null) {
    const reasons = storedReasons.flatMap((reason) => {
      const reasonObject = readJsonObject(reason);
      const code = readString(reasonObject?.code);
      const detail = readString(reasonObject?.detail);

      if (code == null && detail == null) {
        return [];
      }

      return [
        {
          code: code ?? "unknown_reason",
          detail: detail ?? "No policy detail was recorded.",
        },
      ];
    });

    if (reasons.length > 0) {
      return reasons;
    }
  }

  const metadata = readJsonObject(message.metadata);
  const responsePolicy = readJsonObject(metadata?.responsePolicy);
  const reasons = readArray(responsePolicy?.reasons) ?? [];

  return reasons.flatMap((reason) => {
    const reasonObject = readJsonObject(reason);
    const code = readString(reasonObject?.code);
    const detail = readString(reasonObject?.detail);

    if (code == null && detail == null) {
      return [];
    }

    return [
      {
        code: code ?? "unknown_reason",
        detail: detail ?? "No policy detail was recorded.",
      },
    ];
  });
}

function buildOptionCounts(
  values: readonly string[],
  formatLabel: (value: string) => string
): ReviewQueueFilterOption[] {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({
      value,
      label: formatLabel(value),
      count,
    }));
}

function formatConfidenceBandLabel(value: ReviewQueueConfidenceBand): string {
  switch (value) {
    case "low":
      return "Low (<0.75)";
    case "medium":
      return "Medium (0.75-0.89)";
    case "high":
      return "High (>=0.90)";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustiveCheck: never = value;
      return exhaustiveCheck;
    }
  }
}

function formatOptionLabel(value: string): string {
  return value.replaceAll("_", " ");
}

async function listQueuedReviewDrafts(): Promise<Message[]> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("messages")
    .select("*")
    .eq("source", AI_DRAFT_SOURCE)
    .eq("status", REVIEW_QUEUE_STATUS)
    .order("created_at", { ascending: false })
    .limit(REVIEW_QUEUE_LIMIT);

  if (result.error != null) {
    throw new Error(`Failed to list review queue drafts: ${result.error.message}`);
  }

  return result.data;
}

async function listConversationsByIds(
  conversationIds: readonly string[]
): Promise<Map<string, Conversation>> {
  if (conversationIds.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("conversations")
    .select("*")
    .in("id", [...conversationIds]);

  if (result.error != null) {
    throw new Error(
      `Failed to fetch review queue conversations: ${result.error.message}`
    );
  }

  return new Map(result.data.map((conversation) => [conversation.id, conversation]));
}

async function listTenantsByIds(
  tenantIds: readonly string[]
): Promise<Map<string, Tenant>> {
  if (tenantIds.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("venue_tenants")
    .select("*")
    .in("id", [...tenantIds]);

  if (result.error != null) {
    throw new Error(`Failed to fetch review queue tenants: ${result.error.message}`);
  }

  return new Map(result.data.map((tenant) => [tenant.id, tenant]));
}

async function listMessagesByIds(
  messageIds: readonly string[]
): Promise<Map<string, Message>> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("messages")
    .select("*")
    .in("id", [...messageIds]);

  if (result.error != null) {
    throw new Error(
      `Failed to fetch review queue inbound messages: ${result.error.message}`
    );
  }

  return new Map(result.data.map((message) => [message.id, message]));
}

async function listLatestInboundMessages(
  conversationIds: readonly string[]
): Promise<Map<string, Message>> {
  if (conversationIds.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("messages")
    .select("*")
    .in("conversation_id", [...conversationIds])
    .eq("direction", "inbound")
    .order("created_at", { ascending: false });

  if (result.error != null) {
    throw new Error(
      `Failed to fetch review queue latest inbound messages: ${result.error.message}`
    );
  }

  const latestByConversation = new Map<string, Message>();

  result.data.forEach((message) => {
    if (!latestByConversation.has(message.conversation_id)) {
      latestByConversation.set(message.conversation_id, message);
    }
  });

  return latestByConversation;
}

async function buildReviewQueueItems(
  drafts: readonly Message[]
): Promise<ReviewQueueItem[]> {
  const conversationsById = await listConversationsByIds(
    [...new Set(drafts.map((draft) => draft.conversation_id))]
  );
  const tenantsById = await listTenantsByIds(
    [
      ...new Set(
        [...conversationsById.values()].map((conversation) => conversation.tenant_id)
      ),
    ]
  );
  const inboundMessageIds = [
    ...new Set(
      drafts
        .map((draft) => readInboundMessageId(draft))
        .filter((value): value is string => value != null)
    ),
  ];
  const inboundMessagesById = await listMessagesByIds(inboundMessageIds);
  const fallbackInboundByConversation = await listLatestInboundMessages(
    drafts
      .filter((draft) => readInboundMessageId(draft) == null)
      .map((draft) => draft.conversation_id)
  );

  return drafts.flatMap((draft) => {
    const conversation = conversationsById.get(draft.conversation_id);

    if (conversation == null) {
      return [];
    }

    const tenant = tenantsById.get(conversation.tenant_id);

    if (tenant == null) {
      return [];
    }

    const inboundMessageId = readInboundMessageId(draft);
    const inboundMessage =
      (inboundMessageId != null
        ? inboundMessagesById.get(inboundMessageId)
        : undefined) ?? fallbackInboundByConversation.get(conversation.id);
    const confidence = readConfidence(draft);

    return [
      {
        id: draft.id,
        conversationId: conversation.id,
        tenantId: tenant.id,
        tenantName: tenant.name,
        status: conversation.status,
        inboundExcerpt: summarizeExcerpt(inboundMessage?.content ?? null),
        route: readRoute(draft),
        confidence,
        confidenceBand: getReviewQueueConfidenceBand(confidence),
        policyDecision: readPolicyDecision(draft),
        policyReasons: readPolicyReasons(draft),
        createdAt: draft.created_at,
      },
    ];
  });
}

export async function getMissionControlReviewQueue(
  filters: ReviewQueueFilters = {}
): Promise<MissionControlReviewQueueData> {
  const [tenants, drafts] = await Promise.all([
    listTenants({
      limit: 100,
    }),
    listQueuedReviewDrafts(),
  ]);
  const items = await buildReviewQueueItems(drafts);
  const filteredItems = filterReviewQueueItems(items, filters);
  const selectedTenant =
    filters.tenantId == null
      ? null
      : tenants.find((tenant) => tenant.id === filters.tenantId) ?? null;

  return {
    tenants,
    selectedTenant,
    resolvedOutboundMode: resolveOutboundModeForTenant(selectedTenant),
    filters,
    items: filteredItems,
    totalCount: items.length,
    routes: buildOptionCounts(
      items
        .map((item) => item.route)
        .filter((value): value is string => value != null),
      formatOptionLabel
    ),
    statuses: buildOptionCounts(
      items
        .map((item) => item.status)
        .filter((value): value is string => value.trim().length > 0),
      formatOptionLabel
    ),
    confidenceBands: REVIEW_QUEUE_CONFIDENCE_BANDS.map((band) => ({
      value: band,
      label: formatConfidenceBandLabel(band),
      count: items.filter((item) => item.confidenceBand === band).length,
    })),
    stats: {
      reviewCount: items.length,
      tenantCount: new Set(items.map((item) => item.tenantId)).size,
      lowConfidenceCount: items.filter(
        (item) => item.confidenceBand === "low"
      ).length,
    },
  };
}
