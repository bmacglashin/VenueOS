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
type CapturedAuditEvent = {
  eventType: string;
  requestId: string;
  traceId: string;
  errorType: string | null;
  status: string;
  payload: AuditCapture;
};

const OBSERVABILITY = {
  requestId: "req_test_123",
  traceId: "trace_test_456",
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
    event_type: "response.drafted",
    request_id: OBSERVABILITY.requestId,
    trace_id: OBSERVABILITY.traceId,
    error_type: null,
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
      observability: OBSERVABILITY,
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

function captureAuditEvent(
  auditEvents: CapturedAuditEvent[],
  input: {
    tenantId: string;
    eventType: string;
    requestId: string;
    traceId: string;
    errorType?: string | null;
    payload?: unknown;
    status?: string;
  }
) {
  auditEvents.push({
    eventType: input.eventType,
    requestId: input.requestId,
    traceId: input.traceId,
    errorType: input.errorType ?? null,
    payload: (input.payload as AuditCapture | undefined) ?? {},
    status: input.status ?? "recorded",
  });

  return makeAuditLog({
    tenant_id: input.tenantId,
    event_type: input.eventType,
    request_id: input.requestId,
    trace_id: input.traceId,
    error_type: input.errorType ?? null,
    payload: (input.payload as AuditLog["payload"]) ?? {},
    status: input.status ?? "recorded",
  });
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
  it("propagates observability IDs through review-queued turns", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = makeRecentMessages();
    const auditEvents: CapturedAuditEvent[] = [];
    let insertedOutboundInput: OutboundCapture | null = null;
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      findMessageByGhlMessageId: async () => null,
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
      insertAuditLog: async (input) => captureAuditEvent(auditEvents, input),
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
      observability: OBSERVABILITY,
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
    assert.deepEqual(result.observability, OBSERVABILITY);
    assert.deepEqual(result.metadata.observability, OBSERVABILITY);
    assert.equal(transportCalls, 0);

    assert.ok(insertedOutboundInput);
    const outboundCapture = insertedOutboundInput as OutboundCapture;
    assert.equal(outboundCapture.status, "queued_for_review");
    assert.equal(outboundCapture.policyDecision, "needs_review");
    assert.deepEqual(
      outboundCapture.policyReasons?.map((reason) => reason.code),
      ["pricing_unverified"]
    );

    assert.deepEqual(
      auditEvents.map((event) => event.eventType),
      [
        "route.classified",
        "policy.evaluated",
        "response.drafted",
        "review.queued",
      ]
    );
    assert.ok(
      auditEvents.every(
        (event) =>
          event.requestId === OBSERVABILITY.requestId &&
          event.traceId === OBSERVABILITY.traceId
      )
    );

    const policyEvent = auditEvents.find(
      (event) => event.eventType === "policy.evaluated"
    );
    const reviewEvent = auditEvents.find(
      (event) => event.eventType === "review.queued"
    );

    assert.equal(policyEvent?.payload.responsePolicy?.decision, "needs_review");
    assert.equal(reviewEvent?.payload.outboundDelivery?.action, "queue");
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
      findMessageByGhlMessageId: async () => null,
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
      insertAuditLog: async (input) => makeAuditLog({
        tenant_id: input.tenantId,
        event_type: input.eventType,
        request_id: input.requestId,
        trace_id: input.traceId,
        error_type: input.errorType ?? null,
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
      observability: OBSERVABILITY,
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
    assert.deepEqual(result.policy.observability, OBSERVABILITY);
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
    const auditEvents: CapturedAuditEvent[] = [];
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      findMessageByGhlMessageId: async () => null,
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
      insertAuditLog: async (input) => captureAuditEvent(auditEvents, input),
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
      observability: OBSERVABILITY,
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
    assert.deepEqual(
      auditEvents.map((event) => event.eventType),
      [
        "route.classified",
        "policy.evaluated",
        "response.drafted",
        "outbound.blocked",
      ]
    );
    assert.ok(
      auditEvents.every(
        (event) =>
          event.requestId === OBSERVABILITY.requestId &&
          event.traceId === OBSERVABILITY.traceId
      )
    );
    assert.equal(
      auditEvents.some((event) => event.eventType === "outbound.sent"),
      false
    );

    const draftedEvent = auditEvents.find(
      (event) => event.eventType === "response.drafted"
    );

    assert.equal(draftedEvent?.payload.outboundDelivery?.action, "block");
    assert.deepEqual(
      draftedEvent?.payload.outboundDelivery?.reasons?.map(
        (reason: { code: string }) => reason.code
      ),
      ["global_disabled"]
    );
  });

  it("records idempotency drops as a dedicated audit event", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const existingInboundMessage = makeMessage({
      id: "00000000-0000-0000-0000-000000000031",
      conversation_id: conversation.id,
      direction: "inbound",
      role: "user",
      source: "ghl_webhook_internal",
      status: "recorded",
      content: "Already processed",
      ghl_message_id: "ghl-msg-123",
    });
    const auditEvents: CapturedAuditEvent[] = [];
    let routeCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => {
        throw new Error("duplicate turns should stop before fetching messages");
      },
      findMessageByGhlMessageId: async () => existingInboundMessage,
      routeInboundMessage: async () => {
        routeCalls += 1;
        return makeRouteResult("Should never route", conversation);
      },
      insertInboundMessage: async () => {
        throw new Error("duplicate turns should not insert inbound messages");
      },
      insertOutboundMessage: async () => {
        throw new Error("duplicate turns should not insert outbound drafts");
      },
      insertAuditLog: async (input) => captureAuditEvent(auditEvents, input),
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        throw new Error("duplicate turns should not dispatch transport");
      },
      now: () => new Date("2026-04-10T16:00:00.000Z"),
    });

    await assert.rejects(
      orchestrateConversationTurn({
        tenantId: conversation.tenant_id,
        observability: OBSERVABILITY,
        venue: {
          id: conversation.tenant_id,
          venueName: "Test Venue",
        },
        conversation: {
          id: conversation.id,
        },
        inbound: {
          content: "Already processed",
          source: "ghl_webhook_internal",
          role: "user",
          ghlMessageId: "ghl-msg-123",
        },
      }),
      (error: unknown) =>
        error instanceof Error && error.name === "IdempotencyDropError"
    );

    assert.equal(routeCalls, 0);
    assert.deepEqual(
      auditEvents.map((event) => event.eventType),
      ["idempotency.dropped"]
    );
    assert.equal(auditEvents[0]?.status, "dropped");
    assert.equal(auditEvents[0]?.errorType, "idempotency_drop");
  });

  it("dispatches outbound transport when mode is enabled and policy allows send", async () => {
    const { createConversationOrchestrator } = await import(
      "./conversation-orchestrator-core"
    );

    const conversation = makeConversation();
    const recentMessages = makeRecentMessages();
    const auditEvents: CapturedAuditEvent[] = [];
    let transportCalls = 0;

    const orchestrateConversationTurn = createConversationOrchestrator({
      resolveConversation: async () => conversation,
      fetchRecentMessages: async () => recentMessages,
      findMessageByGhlMessageId: async () => null,
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
      insertAuditLog: async (input) => captureAuditEvent(auditEvents, input),
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
          observability: OBSERVABILITY,
        };
      },
      now: () => new Date("2026-04-10T16:00:00.000Z"),
    });

    const result = await orchestrateConversationTurn({
      tenantId: conversation.tenant_id,
      observability: OBSERVABILITY,
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
    assert.deepEqual(result.outboundTransport?.observability, OBSERVABILITY);
    assert.deepEqual(
      auditEvents.map((event) => event.eventType),
      [
        "route.classified",
        "policy.evaluated",
        "response.drafted",
        "outbound.sent",
      ]
    );
  });
});
