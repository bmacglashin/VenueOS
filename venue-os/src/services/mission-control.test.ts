import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "../lib/db/supabase";
import { resolveOutboundMode } from "./outbound-control";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

function setRequiredEnv() {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-google-key";
  process.env.GOOGLE_MODEL ??= "test-model";
  process.env.SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
  process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
  process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
  process.env.GHL_API_KEY ??= "test-ghl-key";
  process.env.GHL_LOCATION_ID ??= "mock-veritas-location";
  process.env.GHL_BASE_URL ??= "https://services.example.com";
  process.env.OUTBOUND_MODE ??= "review_only";
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "tenant-a",
    name: "Tenant A",
    slug: "tenant-a",
    ghl_location_id: "mock-tenant-a",
    outbound_mode_override: null,
    created_at: "2026-04-11T14:00:00.000Z",
    updated_at: "2026-04-11T14:00:00.000Z",
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-a",
    tenant_id: "tenant-a",
    ghl_contact_id: "contact-a",
    ghl_conversation_id: "ghl-conversation-a",
    status: "open",
    created_at: "2026-04-11T14:00:00.000Z",
    updated_at: "2026-04-11T14:00:00.000Z",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-a",
    conversation_id: "conversation-a",
    role: "assistant",
    content: "Default content",
    direction: "outbound",
    ghl_message_id: null,
    source: "venue_os_ai_draft",
    status: "queued_for_review",
    raw_payload: {},
    metadata: {},
    policy_decision: "needs_review",
    policy_reasons: [],
    policy_evaluated_at: "2026-04-11T14:00:00.000Z",
    created_at: "2026-04-11T14:00:00.000Z",
    updated_at: "2026-04-11T14:00:00.000Z",
    ...overrides,
  };
}

describe("createMissionControlService", () => {
  it("returns null when a tenant-scoped conversation detail request targets another tenant", async () => {
    setRequiredEnv();

    const { createMissionControlService } = await import("./mission-control");

    const tenantA = makeTenant({
      id: "tenant-a",
      name: "Veritas Vineyard",
      slug: "veritas",
    });
    const tenantB = makeTenant({
      id: "tenant-b",
      name: "Harborview Loft",
      slug: "harborview-loft",
      ghl_location_id: "mock-tenant-b",
    });
    const conversationA = makeConversation({
      id: "conversation-a",
      tenant_id: tenantA.id,
    });
    const conversationB = makeConversation({
      id: "conversation-b",
      tenant_id: tenantB.id,
      status: "pending",
    });
    const inboundA = makeMessage({
      id: "inbound-a",
      conversation_id: conversationA.id,
      role: "user",
      direction: "inbound",
      source: "website_inquiry_seed",
      content: "Tenant A inbound",
    });
    const draftA = makeMessage({
      id: "draft-a",
      conversation_id: conversationA.id,
      content: "Tenant A draft",
      metadata: {
        route: {
          category: "general_hospitality",
          confidence: 0.8,
          requiresHumanReview: true,
          rationale: "Tenant A route.",
        },
      },
    });
    const inboundB = makeMessage({
      id: "inbound-b",
      conversation_id: conversationB.id,
      role: "user",
      direction: "inbound",
      source: "website_inquiry_seed",
      content: "Tenant B inbound",
    });
    const draftB = makeMessage({
      id: "draft-b",
      conversation_id: conversationB.id,
      content: "Tenant B draft",
      metadata: {
        route: {
          category: "high_ticket_event",
          confidence: 0.9,
          requiresHumanReview: true,
          rationale: "Tenant B route.",
        },
      },
    });

    const conversationMessages = new Map<string, Message[]>([
      [conversationA.id, [inboundA, draftA]],
      [conversationB.id, [inboundB, draftB]],
    ]);
    const tenantsById = new Map<string, Tenant>([
      [tenantA.id, tenantA],
      [tenantB.id, tenantB],
    ]);
    const conversationsById = new Map<string, Conversation>([
      [conversationA.id, conversationA],
      [conversationB.id, conversationB],
    ]);

    const service = createMissionControlService({
      findOrCreateTenant: async () => tenantA,
      getConversationById: async (conversationId) =>
        conversationsById.get(conversationId) ?? null,
      getConversationByIdForTenant: async ({ tenantId, conversationId }) => {
        const conversation = conversationsById.get(conversationId) ?? null;
        return conversation?.tenant_id === tenantId ? conversation : null;
      },
      getConversationWithMessages: async (conversationId) => {
        const conversation = conversationsById.get(conversationId) ?? null;

        if (conversation == null) {
          return null;
        }

        return {
          conversation,
          messages: conversationMessages.get(conversation.id) ?? [],
        };
      },
      getConversationWithMessagesForTenant: async ({
        tenantId,
        conversationId,
      }) => {
        const conversation = conversationsById.get(conversationId) ?? null;

        if (conversation == null || conversation.tenant_id !== tenantId) {
          return null;
        }

        return {
          conversation,
          messages: conversationMessages.get(conversation.id) ?? [],
        };
      },
      getTenantById: async (tenantId) => tenantsById.get(tenantId) ?? null,
      listAuditLogs: async () => [],
      listConversations: async ({ tenantId }) =>
        [...conversationsById.values()].filter(
          (conversation) => conversation.tenant_id === tenantId
        ),
      listTenants: async () => [tenantA, tenantB],
      fetchRecentMessagesForTenant: async ({ tenantId, conversationId }) => {
        const conversation = conversationsById.get(conversationId) ?? null;

        if (conversation == null || conversation.tenant_id !== tenantId) {
          return [];
        }

        return conversationMessages.get(conversationId) ?? [];
      },
      resolveOutboundModeForTenant: (tenant) =>
        resolveOutboundMode({
          globalMode: "review_only",
          tenantOverride: tenant?.outbound_mode_override ?? null,
        }),
      orchestrateConversationTurn: async () => {
        throw new Error("detail lookup should not orchestrate");
      },
    });

    const crossTenantDetail = await service.getMissionControlConversationDetail({
      tenantId: tenantA.id,
      conversationId: conversationB.id,
    });

    assert.equal(crossTenantDetail, null);

    const sandboxData = await service.getMissionControlSandboxData({
      tenantId: tenantA.id,
      conversationId: conversationB.id,
    });

    assert.equal(sandboxData.selectedConversation, null);
    assert.equal(sandboxData.selectedTenant?.id, tenantA.id);
    assert.deepEqual(
      sandboxData.conversations.map((conversation) => conversation.conversation.id),
      [conversationA.id]
    );

    await assert.rejects(
      service.runMissionControlSandboxTurn({
        tenantId: tenantA.id,
        conversationId: conversationB.id,
        message: "Run a sandbox turn",
      }),
      /active tenant scope/
    );
  });
});
