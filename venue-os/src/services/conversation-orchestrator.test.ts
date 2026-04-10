import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "../lib/db/supabase";
import { evaluateResponsePolicy } from "./response-policy";
import { classifyCandidateResponseForSafeSend } from "./safe-send-classifier";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];
type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
type OutboundCapture = {
  policyDecision?: string | null;
  policyReasons?: Array<{ code: string }>;
};
type AuditCapture = {
  responsePolicy?: { decision: string };
};

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    ghl_contact_id: "contact-123",
    ghl_conversation_id: "conversation-123",
    status: "open",
    created_at: "2026-04-10T16:00:00.000Z",
    updated_at: "2026-04-10T16:00:00.000Z",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "00000000-0000-0000-0000-000000000020",
    conversation_id: "00000000-0000-0000-0000-000000000010",
    role: "assistant",
    content: "Default message",
    direction: "outbound",
    ghl_message_id: null,
    source: "test",
    status: "draft",
    raw_payload: {},
    metadata: {},
    policy_decision: null,
    policy_reasons: [],
    policy_evaluated_at: null,
    created_at: "2026-04-10T16:00:00.000Z",
    updated_at: "2026-04-10T16:00:00.000Z",
    ...overrides,
  };
}

function makeAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: "00000000-0000-0000-0000-000000000030",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    event_type: "conversation_turn.persisted",
    payload: {},
    status: "recorded",
    created_at: "2026-04-10T16:00:00.000Z",
    updated_at: "2026-04-10T16:00:00.000Z",
    ...overrides,
  };
}

process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-google-key";
process.env.GOOGLE_MODEL ??= "test-model";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.GHL_API_KEY ??= "test-ghl-key";
process.env.GHL_LOCATION_ID ??= "test-location-id";
process.env.GHL_BASE_URL ??= "https://services.example.com";

describe("createConversationOrchestrator", () => {
  it("queues risky pricing replies instead of marking them transport-safe", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = [
      makeMessage({
        id: "00000000-0000-0000-0000-000000000021",
        direction: "inbound",
        role: "user",
        source: "ghl_webhook_internal",
        status: "recorded",
        content: "Can you share pricing?",
        created_at: "2026-04-10T15:58:00.000Z",
        updated_at: "2026-04-10T15:58:00.000Z",
      }),
    ];

    let insertedOutboundInput: OutboundCapture | null = null;
    let insertedAuditPayload: AuditCapture | null = null;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      routeInboundMessage: async () => ({
        classification: {
          category: "general_hospitality",
          confidence: 0.94,
          requiresHumanReview: false,
          rationale: "The guest is asking a standard venue question.",
        },
        aiReply: "Our room fee is $2,500 plus tax for this package.",
        metadata: {
          knowledgeSource: "getVenueKnowledge",
          knowledgeContextCharacters: 120,
          recentMessageCount: recentMessages.length,
          replySource: "venue_model",
          classificationMetadata: {
            provider: "google.generative-ai",
            model: "test-model",
            promptVersion: "shift-3-v1",
            purpose: "inbound_message_routing",
          },
          responseMetadata: {
            provider: "google.generative-ai",
            model: "test-model",
            mode: "general_hospitality",
            promptVersion: "shift-3-v1",
            classificationSource: "mode",
            recentMessageCount: recentMessages.length,
            knowledgeContextItems: 1,
          },
          persistence: {
            venueId: conversation.tenant_id,
            venueName: "Test Venue",
            conversationId: conversation.id,
            routedAt: "2026-04-10T16:00:00.000Z",
            routeCategory: "general_hospitality",
            routeConfidence: 0.94,
            requiresHumanReview: false,
            rationale: "The guest is asking a standard venue question.",
            replySource: "venue_model",
          },
        },
      }),
      insertInboundMessage: async () =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000022",
          conversation_id: conversation.id,
          direction: "inbound",
          role: "user",
          source: "ghl_webhook_internal",
          status: "recorded",
          content: "Can you share pricing?",
        }),
      insertOutboundMessage: async (input) => {
        insertedOutboundInput = {
          policyDecision: input.policyDecision ?? null,
          policyReasons:
            (input.policyReasons as Array<{ code: string }> | undefined) ?? [],
        };

        return makeMessage({
          id: "00000000-0000-0000-0000-000000000023",
          conversation_id: conversation.id,
          role: "assistant",
          direction: "outbound",
          source: String(input.source),
          status: String(input.status ?? "draft"),
          content: String(input.content),
          metadata: (input.metadata as Message["metadata"]) ?? {},
          policy_decision:
            (input.policyDecision as Message["policy_decision"]) ?? null,
          policy_reasons:
            (JSON.parse(
              JSON.stringify(input.policyReasons ?? [])
            ) as Message["policy_reasons"]) ?? [],
          policy_evaluated_at:
            (input.policyEvaluatedAt as Message["policy_evaluated_at"]) ?? null,
        });
      },
      insertAuditLog: async (input) => {
        insertedAuditPayload =
          (input.payload as AuditCapture | undefined) ??
          null;

        return makeAuditLog({
          tenant_id: input.tenantId,
          event_type: input.eventType,
          payload: input.payload ?? {},
          status: input.status ?? "recorded",
        });
      },
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      now: () => new Date("2026-04-10T16:00:00.000Z"),
    });

    const result = await orchestrateConversationTurn({
      tenantId: conversation.tenant_id,
      venue: {
        id: conversation.tenant_id,
        venueName: "Test Venue",
      },
      conversation: {
        id: conversation.id,
      },
      inbound: {
        content: "Can you share pricing?",
        source: "ghl_webhook_internal",
        role: "user",
        receivedAt: "2026-04-10T16:00:00.000Z",
      },
    });

    assert.equal(result.policy.decision, "needs_review");
    assert.equal(result.policy.transportAllowed, false);
    assert.equal(result.safeSendClassification.pricingDiscussed, true);

    assert.ok(insertedOutboundInput);
    assert.ok(insertedAuditPayload);
    const outboundCapture = insertedOutboundInput as OutboundCapture;
    const auditCapture = insertedAuditPayload as AuditCapture;

    assert.equal(outboundCapture.policyDecision, "needs_review");
    assert.deepEqual(
      outboundCapture.policyReasons?.map(
        (reason: { code: string }) => reason.code
      ),
      ["pricing_unverified"]
    );

    assert.equal(auditCapture.responsePolicy != null, true);
    assert.equal(auditCapture.responsePolicy?.decision, "needs_review");
  });
});
