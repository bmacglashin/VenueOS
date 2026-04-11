import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "../lib/db/supabase";
import {
  getDraftVersionSnapshot,
  OPERATOR_EDIT_SOURCE,
} from "./draft-history";
import { resolveOutboundMode } from "./outbound-control";
import { createOperatorReviewService } from "./operator-review";
import { evaluateResponsePolicy } from "./response-policy";
import { classifyCandidateResponseForSafeSend } from "./safe-send-classifier";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

const OBSERVABILITY = {
  requestId: "req_operator_123",
  traceId: "trace_operator_456",
};

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Venue",
    slug: "test-venue",
    ghl_location_id: "location-123",
    outbound_mode_override: null,
    created_at: "2026-04-10T16:00:00.000Z",
    updated_at: "2026-04-10T16:00:00.000Z",
    ...overrides,
  };
}

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
    status: "recorded",
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

function makeInboundMessage(
  conversation: Conversation,
  overrides: Partial<Message> = {}
): Message {
  return makeMessage({
    id: "00000000-0000-0000-0000-000000000021",
    conversation_id: conversation.id,
    role: "user",
    direction: "inbound",
    source: "ghl_webhook_internal",
    status: "recorded",
    content: "Can you share pricing for next Saturday?",
    created_at: "2026-04-10T15:59:00.000Z",
    updated_at: "2026-04-10T15:59:00.000Z",
    ...overrides,
  });
}

function makeQueuedDraft(
  conversation: Conversation,
  inboundMessage: Message,
  overrides: Partial<Message> = {}
): Message {
  return makeMessage({
    id: "00000000-0000-0000-0000-000000000022",
    conversation_id: conversation.id,
    role: "assistant",
    direction: "outbound",
    source: "venue_os_ai_draft",
    status: "queued_for_review",
    content: "Our Saturday package is $3,000 plus tax.",
    policy_decision: "needs_review",
    policy_reasons: [
      {
        code: "pricing_unverified",
        detail:
          "The candidate appears to make a pricing claim without deterministic or approved verification.",
      },
    ],
    policy_evaluated_at: "2026-04-10T16:00:00.000Z",
    metadata: {
      kind: "ai_draft",
      route: {
        category: "general_hospitality",
        confidence: 0.95,
        requiresHumanReview: false,
        rationale: "General venue question.",
      },
      responsePolicy: {
        decision: "needs_review",
        reasons: [
          {
            code: "pricing_unverified",
            detail:
              "The candidate appears to make a pricing claim without deterministic or approved verification.",
          },
        ],
        transportAllowed: false,
        evaluatedAt: "2026-04-10T16:00:00.000Z",
        routeConfidenceThreshold: 0.75,
      },
      outboundDelivery: {
        action: "queue",
        reasons: [
          {
            code: "policy_needs_review",
            detail:
              "The 12A.1 response policy requires operator review before outbound send.",
          },
        ],
        transport: null,
      },
      router: {
        persistence: {
          conversationId: conversation.id,
          inboundMessageId: inboundMessage.id,
        },
      },
      draftVersion: {
        familyId: inboundMessage.id,
        version: 1,
        parentMessageId: null,
        originInboundMessageId: inboundMessage.id,
        kind: "ai_draft",
        createdBy: "orchestrator",
        createdAt: "2026-04-10T16:00:00.000Z",
      },
    },
    created_at: "2026-04-10T16:00:01.000Z",
    updated_at: "2026-04-10T16:00:01.000Z",
    ...overrides,
  });
}

describe("createOperatorReviewService", () => {
  it("approves a queued draft through the shared transport path", async () => {
    const tenant = makeTenant();
    const conversation = makeConversation();
    const inboundMessage = makeInboundMessage(conversation);
    const queuedDraft = makeQueuedDraft(conversation, inboundMessage);
    const auditCalls: Array<{ eventType: string; payload: unknown }> = [];
    const updateCalls: Array<{ messageId: string; status?: string; metadata?: unknown }> =
      [];
    let transportCallCount = 0;

    const service = createOperatorReviewService({
      getConversationById: async () => conversation,
      getTenantById: async () => tenant,
      listConversationMessages: async () => [inboundMessage, queuedDraft],
      updateMessage: async (input) => {
        updateCalls.push({
          messageId: input.messageId,
          status: input.status,
          metadata: input.metadata,
        });

        return makeMessage({
          ...queuedDraft,
          status: input.status ?? queuedDraft.status,
          metadata: (input.metadata as Message["metadata"]) ?? queuedDraft.metadata,
        });
      },
      insertOutboundMessage: async () => {
        throw new Error("approve should not create a new outbound message");
      },
      insertAuditLog: async (input) => {
        auditCalls.push({
          eventType: input.eventType,
          payload: input.payload,
        });
        return {};
      },
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        transportCallCount += 1;

        return {
          attempted: true,
          outcome: "skipped" as const,
          provider: "pending_live_wiring" as const,
          detail: "test transport",
          dispatchedAt: "2026-04-10T16:01:00.000Z",
          observability: OBSERVABILITY,
        };
      },
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      regenerateConversationDraft: async () => {
        throw new Error("approve should not regenerate");
      },
      now: () => new Date("2026-04-10T16:01:00.000Z"),
    });

    await service.approveDraftAndSend({
      conversationId: conversation.id,
      draftMessageId: queuedDraft.id,
    });

    assert.equal(transportCallCount, 1);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.messageId, queuedDraft.id);
    assert.equal(updateCalls[0]?.status, "send_skipped");
    const approvedMetadata = updateCalls[0]?.metadata as Message["metadata"];
    assert.equal(
      (approvedMetadata as { operatorReview?: { action?: string } }).operatorReview
        ?.action,
      "approve_and_send"
    );
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0]?.eventType, "operator_action.approve_and_send");
  });

  it("creates a new edited version, preserves history, and sends the revision", async () => {
    const tenant = makeTenant();
    const conversation = makeConversation();
    const inboundMessage = makeInboundMessage(conversation, {
      content: "Do you have availability next week?",
    });
    const queuedDraft = makeQueuedDraft(conversation, inboundMessage, {
      content: "We have plenty of openings next week and the package is $3,000.",
    });
    const updateCalls: Array<{ messageId: string; status?: string; metadata?: unknown }> =
      [];
    const insertedOutbound: Array<{
      content: string;
      source: string;
      status?: string;
      metadata?: unknown;
      policyDecision?: string | null;
    }> = [];
    const auditCalls: Array<{ eventType: string; payload: unknown }> = [];

    const service = createOperatorReviewService({
      getConversationById: async () => conversation,
      getTenantById: async () => tenant,
      listConversationMessages: async () => [inboundMessage, queuedDraft],
      updateMessage: async (input) => {
        updateCalls.push({
          messageId: input.messageId,
          status: input.status,
          metadata: input.metadata,
        });

        return makeMessage({
          id: input.messageId,
          conversation_id: conversation.id,
          content:
            typeof input.content === "string"
              ? input.content
              : input.messageId === queuedDraft.id
                ? queuedDraft.content
                : "Thanks for reaching out. A team member will follow up shortly.",
          source:
            input.messageId === queuedDraft.id
              ? queuedDraft.source
              : OPERATOR_EDIT_SOURCE,
          status: input.status ?? "recorded",
          metadata: (input.metadata as Message["metadata"]) ?? {},
          policy_decision:
            (input.policyDecision as Message["policy_decision"]) ?? "safe_to_send",
          policy_reasons:
            (JSON.parse(
              JSON.stringify(input.policyReasons ?? [])
            ) as Message["policy_reasons"]) ?? [],
          policy_evaluated_at:
            (input.policyEvaluatedAt as Message["policy_evaluated_at"]) ??
            "2026-04-10T16:02:00.000Z",
        });
      },
      insertOutboundMessage: async (input) => {
        insertedOutbound.push({
          content: String(input.content),
          source: String(input.source),
          status: input.status,
          metadata: input.metadata,
          policyDecision: input.policyDecision ?? null,
        });

        return makeMessage({
          id: "00000000-0000-0000-0000-000000000023",
          conversation_id: conversation.id,
          content: String(input.content),
          source: String(input.source),
          status: String(input.status ?? "recorded"),
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
        auditCalls.push({
          eventType: input.eventType,
          payload: input.payload,
        });
        return {};
      },
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => ({
        attempted: true,
        outcome: "skipped" as const,
        provider: "pending_live_wiring" as const,
        detail: "edited transport",
        dispatchedAt: "2026-04-10T16:02:00.000Z",
        observability: OBSERVABILITY,
      }),
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      regenerateConversationDraft: async () => {
        throw new Error("edit should not regenerate");
      },
      now: () => new Date("2026-04-10T16:02:00.000Z"),
    });

    await service.editDraftAndSend({
      conversationId: conversation.id,
      draftMessageId: queuedDraft.id,
      content: "Thanks for reaching out. A team member will follow up shortly.",
    });

    assert.equal(insertedOutbound.length, 1);
    assert.equal(insertedOutbound[0]?.source, OPERATOR_EDIT_SOURCE);
    assert.equal(insertedOutbound[0]?.policyDecision, "safe_to_send");

    assert.equal(updateCalls.length, 2);
    assert.equal(updateCalls[0]?.messageId, "00000000-0000-0000-0000-000000000023");
    assert.equal(updateCalls[0]?.status, "send_skipped");
    assert.equal(updateCalls[1]?.messageId, queuedDraft.id);
    assert.equal(updateCalls[1]?.status, "superseded");

    const finalEditedMetadata = updateCalls[0]?.metadata as Message["metadata"];
    const draftVersion = getDraftVersionSnapshot(
      makeMessage({
        id: "00000000-0000-0000-0000-000000000023",
        metadata: finalEditedMetadata,
      })
    );
    assert.equal(draftVersion?.version, 2);
    assert.equal(draftVersion?.kind, "operator_edit");

    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0]?.eventType, "operator_action.edit_and_send");
  });

  it("stores manual notes as operator audit events", async () => {
    const tenant = makeTenant();
    const conversation = makeConversation();
    const inboundMessage = makeInboundMessage(conversation);
    const queuedDraft = makeQueuedDraft(conversation, inboundMessage);
    const auditCalls: Array<{ eventType: string; payload: unknown }> = [];

    const service = createOperatorReviewService({
      getConversationById: async () => conversation,
      getTenantById: async () => tenant,
      listConversationMessages: async () => [inboundMessage, queuedDraft],
      updateMessage: async () => {
        throw new Error("notes should not update messages");
      },
      insertOutboundMessage: async () => {
        throw new Error("notes should not insert messages");
      },
      insertAuditLog: async (input) => {
        auditCalls.push({
          eventType: input.eventType,
          payload: input.payload,
        });
        return {};
      },
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        throw new Error("notes should not send");
      },
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      regenerateConversationDraft: async () => {
        throw new Error("notes should not regenerate");
      },
      now: () => new Date("2026-04-10T16:03:00.000Z"),
    });

    await service.addManualNote({
      conversationId: conversation.id,
      note: "Waiting for confirmation from events before sending.",
    });

    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0]?.eventType, "operator_action.note_added");
    const payload = auditCalls[0]?.payload as { note?: string };
    assert.equal(
      payload.note,
      "Waiting for confirmation from events before sending."
    );
  });

  it("routes regenerate requests through the shared regeneration service", async () => {
    const tenant = makeTenant();
    const conversation = makeConversation();
    const inboundMessage = makeInboundMessage(conversation);
    const queuedDraft = makeQueuedDraft(conversation, inboundMessage);
    let regenerateInput:
      | {
          tenantId: string;
          conversationId: string;
          baseDraftMessageId: string;
          observability?: {
            requestId: string;
            traceId: string;
          };
        }
      | undefined;

    const service = createOperatorReviewService({
      getConversationById: async () => conversation,
      getTenantById: async () => tenant,
      listConversationMessages: async () => [inboundMessage, queuedDraft],
      updateMessage: async () => {
        throw new Error("regenerate delegation test should not update directly");
      },
      insertOutboundMessage: async () => {
        throw new Error("regenerate delegation test should not insert directly");
      },
      insertAuditLog: async () => {
        throw new Error("regenerate delegation test should not audit directly");
      },
      resolveOutboundMode: async () =>
        resolveOutboundMode({
          globalMode: "enabled",
        }),
      dispatchOutboundTransport: async () => {
        throw new Error("regenerate should not send");
      },
      classifyCandidateResponseForSafeSend,
      evaluateResponsePolicy,
      regenerateConversationDraft: async (input) => {
        regenerateInput = input;

        return {
          observability: OBSERVABILITY,
          conversation,
          tenant,
          sourceInboundMessage: inboundMessage,
          recentMessages: [],
          aiDraftMessage: queuedDraft,
          classification: {
            category: "general_hospitality",
            confidence: 0.92,
            requiresHumanReview: false,
            rationale: "General venue question.",
          },
          aiReply: queuedDraft.content,
          metadata: {
            observability: OBSERVABILITY,
            knowledgeSource: "getVenueKnowledge",
            knowledgeContextCharacters: 120,
            recentMessageCount: 1,
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
              recentMessageCount: 1,
              knowledgeContextItems: 1,
            },
            persistence: {
              venueId: tenant.id,
              venueName: tenant.name,
              conversationId: conversation.id,
              routedAt: "2026-04-10T16:04:00.000Z",
              routeCategory: "general_hospitality",
              routeConfidence: 0.92,
              requiresHumanReview: false,
              rationale: "General venue question.",
              replySource: "venue_model",
            },
          },
          safeSendClassification: {
            escalationSignal: false,
            pricingDiscussed: false,
            availabilityDiscussed: false,
            pricingVerification: "not_applicable",
            availabilityVerification: "not_applicable",
          },
          policy: {
            decision: "safe_to_send",
            reasons: [],
            transportAllowed: true,
            routeConfidenceThreshold: 0.75,
            evaluatedAt: "2026-04-10T16:04:00.000Z",
            observability: OBSERVABILITY,
          },
          resolvedOutboundMode: resolveOutboundMode({
            globalMode: "enabled",
          }),
          outboundDecision: {
            action: "queue",
            reasons: [],
          },
        };
      },
      now: () => new Date("2026-04-10T16:04:00.000Z"),
    });

    await service.regenerateDraft({
      conversationId: conversation.id,
      draftMessageId: queuedDraft.id,
    });

    assert.equal(regenerateInput?.tenantId, tenant.id);
    assert.equal(regenerateInput?.conversationId, conversation.id);
    assert.equal(regenerateInput?.baseDraftMessageId, queuedDraft.id);
    assert.equal(typeof regenerateInput?.observability?.requestId, "string");
    assert.equal(typeof regenerateInput?.observability?.traceId, "string");
  });
});
