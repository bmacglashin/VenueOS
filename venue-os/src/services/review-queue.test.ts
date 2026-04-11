import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "../lib/db/supabase";

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

describe("createReviewQueueService", () => {
  it("keeps tenant-filtered queue results and aggregates inside the requested tenant scope", async () => {
    setRequiredEnv();

    const { createReviewQueueService } = await import("./review-queue");

    const tenantA = makeTenant({
      id: "tenant-a",
      name: "Tenant A",
      slug: "veritas",
    });
    const tenantB = makeTenant({
      id: "tenant-b",
      name: "Tenant B",
      slug: "harborview-loft",
      ghl_location_id: "mock-tenant-b",
    });
    const conversationA = makeConversation({
      id: "conversation-a",
      tenant_id: tenantA.id,
      status: "open",
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
      metadata: {},
    });
    const inboundB = makeMessage({
      id: "inbound-b",
      conversation_id: conversationB.id,
      role: "user",
      direction: "inbound",
      source: "website_inquiry_seed",
      content: "Tenant B inbound",
      metadata: {},
    });
    const draftA = makeMessage({
      id: "draft-a",
      conversation_id: conversationA.id,
      content: "Tenant A draft",
      metadata: {
        route: {
          category: "general_hospitality",
          confidence: 0.72,
        },
        router: {
          persistence: {
            inboundMessageId: inboundA.id,
          },
        },
        responsePolicy: {
          decision: "needs_review",
          reasons: [
            {
              code: "availability_unverified",
              detail: "Tenant A needs review.",
            },
          ],
        },
      },
      policy_reasons: [
        {
          code: "availability_unverified",
          detail: "Tenant A needs review.",
        },
      ],
    });
    const draftB = makeMessage({
      id: "draft-b",
      conversation_id: conversationB.id,
      content: "Tenant B draft",
      metadata: {
        route: {
          category: "high_ticket_event",
          confidence: 0.91,
        },
        router: {
          persistence: {
            inboundMessageId: inboundB.id,
          },
        },
        responsePolicy: {
          decision: "needs_review",
          reasons: [
            {
              code: "pricing_unverified",
              detail: "Tenant B needs review.",
            },
          ],
        },
      },
      policy_reasons: [
        {
          code: "pricing_unverified",
          detail: "Tenant B needs review.",
        },
      ],
    });

    let queuedDraftsTenantId: string | undefined;

    const service = createReviewQueueService({
      listTenants: async () => [tenantA, tenantB],
      listQueuedReviewDrafts: async (input) => {
        queuedDraftsTenantId = input.tenantId;
        return input.tenantId === tenantA.id ? [draftA] : [draftA, draftB];
      },
      listConversationsByIds: async (conversationIds) =>
        new Map(
          [conversationA, conversationB]
            .filter((conversation) => conversationIds.includes(conversation.id))
            .map((conversation) => [conversation.id, conversation])
        ),
      listTenantsByIds: async (tenantIds) =>
        new Map(
          [tenantA, tenantB]
            .filter((tenant) => tenantIds.includes(tenant.id))
            .map((tenant) => [tenant.id, tenant])
        ),
      listMessagesByIds: async (messageIds) =>
        new Map(
          [inboundA, inboundB]
            .filter((message) => messageIds.includes(message.id))
            .map((message) => [message.id, message])
        ),
      listLatestInboundMessages: async ({ conversationIds }) =>
        new Map(
          [inboundA, inboundB]
            .filter((message) => conversationIds.includes(message.conversation_id))
            .map((message) => [message.conversation_id, message])
        ),
    });

    const data = await service.getMissionControlReviewQueue({
      tenantId: tenantA.id,
    });

    assert.equal(queuedDraftsTenantId, tenantA.id);
    assert.deepEqual(
      data.items.map((item) => item.tenantId),
      [tenantA.id]
    );
    assert.equal(data.totalCount, 1);
    assert.equal(data.stats.reviewCount, 1);
    assert.equal(data.stats.tenantCount, 1);
    assert.equal(data.stats.lowConfidenceCount, 1);
    assert.deepEqual(
      data.routes.map((route) => route.value),
      ["general_hospitality"]
    );
    assert.deepEqual(
      data.statuses.map((status) => status.value),
      ["open"]
    );
    assert.equal(
      data.items.some((item) => item.tenantId === tenantB.id),
      false
    );
    assert.equal(
      data.routes.some((route) => route.value === "high_ticket_event"),
      false
    );
  });
});
