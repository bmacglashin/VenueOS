import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "../lib/db/supabase";
import type { RouteInboundMessageResult } from "../lib/llm/router";
import { resolveOutboundMode } from "./outbound-control";
import { evaluateResponsePolicy } from "./response-policy";
import { classifyCandidateResponseForSafeSend } from "./safe-send-classifier";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];
type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
type OutboundCapture = {
  status?: string;
  policyDecision?: string | null;
  policyReasons?: Array<{ code: string }>;
};
type AuditCapture = {
  responsePolicy?: { decision: string };
  outboundMode?: { mode?: string };
  outboundDelivery?: {
    action?: string;
    reasons?: Array<{ code: string }>;
    transport?: { outcome?: string } | null;
  };
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

function makeRecentMessages(): Message[] {
  return [
    makeMessage({
      id: "00000000-0000-0000-0000-000000000021",
      direction: "inbound",
      role: "user",
      source: "ghl_webhook_internal",
      status: "recorded",
      content: "Can you help me?",
      created_at: "2026-04-10T15:58:00.000Z",
      updated_at: "2026-04-10T15:58:00.000Z",
    }),
  ];
}

function makeRouteResult(
  aiReply: string,
  conversation: Conversation
): RouteInboundMessageResult {
  return {
    classification: {
      category: "general_hospitality" as const,
      confidence: 0.94,
      requiresHumanReview: false,
      rationale: "The guest is asking a standard venue question.",
    },
    aiReply,
    metadata: {
      knowledgeSource: "getVenueKnowledge" as const,
      knowledgeContextCharacters: 120,
      recentMessageCount: 1,
      replySource: "venue_model" as const,
      classificationMetadata: {
        provider: "google.generative-ai" as const,
        model: "test-model",
        promptVersion: "shift-3-v1",
        purpose: "inbound_message_routing" as const,
      },
      responseMetadata: {
        provider: "google.generative-ai" as const,
        model: "test-model",
        mode: "general_hospitality" as const,
        promptVersion: "shift-3-v1",
        classificationSource: "mode" as const,
        recentMessageCount: 1,
        knowledgeContextItems: 1,
      },
      persistence: {
        venueId: conversation.tenant_id,
        venueName: "Test Venue",
        conversationId: conversation.id,
        routedAt: "2026-04-10T16:00:00.000Z",
        routeCategory: "general_hospitality" as const,
        routeConfidence: 0.94,
        requiresHumanReview: false,
        rationale: "The guest is asking a standard venue question.",
        replySource: "venue_model" as const,
      },
    },
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
process.env.OUTBOUND_MODE ??= "review_only";

describe("createConversationOrchestrator", () => {
  it("queues risky pricing replies instead of marking them transport-safe", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = makeRecentMessages();
    let insertedOutboundInput: OutboundCapture | null = null;
    let insertedAuditPayload: AuditCapture | null = null;
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      routeInboundMessage: async () =>
        makeRouteResult(
          "Our room fee is $2,500 plus tax for this package.",
          conversation
        ),
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
          status: input.status ?? "draft",
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
        insertedAuditPayload = (input.payload as AuditCapture | undefined) ?? null;

        return makeAuditLog({
          tenant_id: input.tenantId,
          event_type: input.eventType,
          payload: input.payload ?? {},
          status: input.status ?? "recorded",
        });
      },
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        transportCalls += 1;
        throw new Error("transport should not be called for review items");
      },
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
    assert.equal(result.outboundDecision.action, "queue");
    assert.equal(transportCalls, 0);

    assert.ok(insertedOutboundInput);
    assert.ok(insertedAuditPayload);
    const outboundCapture = insertedOutboundInput as OutboundCapture;
    const auditCapture = insertedAuditPayload as AuditCapture;

    assert.equal(outboundCapture.status, "queued_for_review");
    assert.equal(outboundCapture.policyDecision, "needs_review");
    assert.deepEqual(
      outboundCapture.policyReasons?.map((reason) => reason.code),
      ["pricing_unverified"]
    );
    assert.equal(auditCapture.responsePolicy?.decision, "needs_review");
    assert.equal(auditCapture.outboundDelivery?.action, "queue");
  });

  it("forces otherwise-safe replies into queue when outbound mode is review_only", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = makeRecentMessages();
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      routeInboundMessage: async () =>
        makeRouteResult(
          "Thanks for reaching out. I can help with that and a team member will follow up shortly.",
          conversation
        ),
      insertInboundMessage: async () =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000024",
          conversation_id: conversation.id,
          direction: "inbound",
          role: "user",
          source: "ghl_webhook_internal",
          status: "recorded",
          content: "Just checking in.",
        }),
      insertOutboundMessage: async (input) =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000025",
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
        }),
      insertAuditLog: async (input) =>
        makeAuditLog({
          tenant_id: input.tenantId,
          event_type: input.eventType,
          payload: input.payload ?? {},
          status: input.status ?? "recorded",
        }),
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "review_only",
          tenantOverride: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        transportCalls += 1;
        throw new Error("transport should not be called in review_only mode");
      },
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
        content: "Just checking in.",
        source: "ghl_webhook_internal",
        role: "user",
        receivedAt: "2026-04-10T16:00:00.000Z",
      },
    });

    assert.equal(result.policy.decision, "safe_to_send");
    assert.equal(result.outboundDecision.action, "queue");
    assert.equal(result.resolvedOutboundMode.mode, "review_only");
    assert.deepEqual(
      result.outboundDecision.reasons.map((reason) => reason.code),
      ["global_review_only"]
    );
    assert.equal(transportCalls, 0);
  });

  it("blocks otherwise-safe replies when outbound mode is disabled and records the reason", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = makeRecentMessages();
    let insertedAuditPayload: AuditCapture | null = null;
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      routeInboundMessage: async () =>
        makeRouteResult(
          "Thanks for reaching out. I can help with that and a team member will follow up shortly.",
          conversation
        ),
      insertInboundMessage: async () =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000026",
          conversation_id: conversation.id,
          direction: "inbound",
          role: "user",
          source: "ghl_webhook_internal",
          status: "recorded",
          content: "Just checking in.",
        }),
      insertOutboundMessage: async (input) =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000027",
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
        }),
      insertAuditLog: async (input) => {
        insertedAuditPayload = (input.payload as AuditCapture | undefined) ?? null;

        return makeAuditLog({
          tenant_id: input.tenantId,
          event_type: input.eventType,
          payload: input.payload ?? {},
          status: input.status ?? "recorded",
        });
      },
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "disabled",
          tenantOverride: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        transportCalls += 1;
        throw new Error("transport should not be called while disabled");
      },
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
        content: "Just checking in.",
        source: "ghl_webhook_internal",
        role: "user",
        receivedAt: "2026-04-10T16:00:00.000Z",
      },
    });

    assert.equal(result.policy.decision, "safe_to_send");
    assert.equal(result.outboundDecision.action, "block");
    assert.equal(result.resolvedOutboundMode.mode, "disabled");
    assert.deepEqual(
      result.outboundDecision.reasons.map((reason) => reason.code),
      ["global_disabled"]
    );
    assert.equal(transportCalls, 0);
    assert.ok(insertedAuditPayload);
    const auditCapture = insertedAuditPayload as AuditCapture;

    assert.equal(auditCapture.outboundDelivery?.action, "block");
    assert.deepEqual(
      auditCapture.outboundDelivery?.reasons?.map(
        (reason: { code: string }) => reason.code
      ),
      ["global_disabled"]
    );
  });

  it("dispatches outbound transport when mode is enabled and policy allows send", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = makeRecentMessages();
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      routeInboundMessage: async () =>
        makeRouteResult(
          "Thanks for reaching out. I can help with that and a team member will follow up shortly.",
          conversation
        ),
      insertInboundMessage: async () =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000028",
          conversation_id: conversation.id,
          direction: "inbound",
          role: "user",
          source: "ghl_webhook_internal",
          status: "recorded",
          content: "Just checking in.",
        }),
      insertOutboundMessage: async (input) =>
        makeMessage({
          id: "00000000-0000-0000-0000-000000000029",
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
        }),
      insertAuditLog: async (input) =>
        makeAuditLog({
          tenant_id: input.tenantId,
          event_type: input.eventType,
          payload: input.payload ?? {},
          status: input.status ?? "recorded",
        }),
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        transportCalls += 1;

        return {
          attempted: true,
          outcome: "skipped" as const,
          provider: "pending_live_wiring" as const,
          detail: "test transport",
          dispatchedAt: "2026-04-10T16:00:00.000Z",
        };
      },
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
        content: "Just checking in.",
        source: "ghl_webhook_internal",
        role: "user",
        receivedAt: "2026-04-10T16:00:00.000Z",
      },
    });

    assert.equal(result.policy.decision, "safe_to_send");
    assert.equal(result.outboundDecision.action, "proceed");
    assert.equal(transportCalls, 1);
    assert.equal(result.outboundTransport?.outcome, "skipped");
  });
});
