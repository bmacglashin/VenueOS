import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "@/src/lib/db/supabase";

import { createWebhookPostHandler } from "./handler";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type ProcessedWebhookEvent =
  Database["public"]["Tables"]["processed_webhook_events"]["Row"];

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Venue",
    slug: "test-venue",
    ghl_location_id: "location-123",
    outbound_mode_override: null,
    created_at: "2026-04-11T14:00:00.000Z",
    updated_at: "2026-04-11T14:00:00.000Z",
    ...overrides,
  };
}

function makeProcessedWebhookEvent(
  overrides: Partial<ProcessedWebhookEvent> = {}
): ProcessedWebhookEvent {
  return {
    id: "00000000-0000-0000-0000-000000000050",
    source: "ghl_webhook_internal",
    idempotency_key: "message:msg-123",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    status: "processed",
    upstream_event_id: null,
    upstream_message_id: "msg-123",
    request_id: "req-original",
    trace_id: "trace-original",
    payload: {},
    response_payload: {
      conversationId: "00000000-0000-0000-0000-000000000010",
      inboundMessageId: "00000000-0000-0000-0000-000000000011",
      aiDraftMessageId: "00000000-0000-0000-0000-000000000012",
    },
    created_at: "2026-04-11T14:00:00.000Z",
    updated_at: "2026-04-11T14:00:00.000Z",
    ...overrides,
  };
}

describe("createWebhookPostHandler", () => {
  it("acknowledges duplicate webhook deliveries without reprocessing", async () => {
    const tenant = makeTenant();
    const auditEvents: string[] = [];
    let orchestrateCalls = 0;

    const POST = createWebhookPostHandler({
      getTenantByGhlLocationId: async () => tenant,
      insertAuditLog: async (input) => {
        auditEvents.push(input.eventType);
        return {} as never;
      },
      orchestrateConversationTurn: async () => {
        orchestrateCalls += 1;
        throw new Error("duplicate requests should not orchestrate");
      },
      claimProcessedWebhookEvent: async () => ({
        claimed: false,
        record: makeProcessedWebhookEvent({
          tenant_id: tenant.id,
        }),
      }),
      markProcessedWebhookEvent: async () => makeProcessedWebhookEvent(),
      releaseProcessedWebhookEventClaim: async () => undefined,
    });

    const response = await POST(
      new Request("https://example.test/api/ghl-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-duplicate-123",
        },
        body: JSON.stringify({
          locationId: tenant.ghl_location_id,
          contactId: "contact-123",
          conversationId: "ghl-conversation-123",
          messageId: "msg-123",
          messageBody: "Hello from a duplicate delivery",
          receivedAt: "2026-04-11T14:05:00.000Z",
        }),
      })
    );

    const body = (await response.json()) as {
      accepted: boolean;
      duplicate: boolean;
      conversationId: string | null;
      inboundMessageId: string | null;
      aiDraftMessageId: string | null;
      errorType: string | null;
    };

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(body.duplicate, true);
    assert.equal(body.errorType, "idempotency_drop");
    assert.equal(body.conversationId, "00000000-0000-0000-0000-000000000010");
    assert.equal(body.inboundMessageId, "00000000-0000-0000-0000-000000000011");
    assert.equal(body.aiDraftMessageId, "00000000-0000-0000-0000-000000000012");
    assert.equal(orchestrateCalls, 0);
    assert.deepEqual(auditEvents, ["inbound.received", "idempotency.dropped"]);
  });
});
