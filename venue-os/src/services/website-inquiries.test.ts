import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "@/src/lib/db/supabase";

import { createWebsiteInquiryService } from "./website-inquiries";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type WebsiteInquiry = Database["public"]["Tables"]["website_inquiries"]["Row"];

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Veritas",
    slug: "veritas",
    ghl_location_id: "loc-veritas",
    outbound_mode_override: null,
    created_at: "2026-04-11T18:00:00.000Z",
    updated_at: "2026-04-11T18:00:00.000Z",
    ...overrides,
  };
}

function makeWebsiteInquiry(
  overrides: Partial<WebsiteInquiry> = {}
): WebsiteInquiry {
  return {
    id: "00000000-0000-0000-0000-000000000301",
    tenant_id: "11111111-1111-4111-8111-111111111111",
    contact_name: "Taylor Brooks",
    email: "taylor@example.com",
    phone: "555-555-0100",
    event_date: "2026-10-18",
    guest_count: 140,
    message: "Looking for availability for an October reception.",
    source: "website_form",
    status: "received",
    raw_payload: {
      tenantSlug: "veritas",
    },
    summary_status: "pending",
    summary_short: null,
    summary_key_facts: [],
    summary_confidence: null,
    summary_metadata: {},
    summary_generated_at: null,
    created_at: "2026-04-11T18:01:00.000Z",
    updated_at: "2026-04-11T18:01:00.000Z",
    ...overrides,
  };
}

describe("createWebsiteInquiryService", () => {
  it("persists before downstream sync and still succeeds when downstream is unavailable", async () => {
    const tenant = makeTenant();
    const inquiry = makeWebsiteInquiry();
    const callOrder: string[] = [];
    const auditEvents: string[] = [];
    let insertedPayload:
      | {
          tenantId: string;
          eventDate: string;
          guestCount: number;
          summaryStatus: string | undefined;
          rawPayload: Database["public"]["Tables"]["website_inquiries"]["Insert"]["raw_payload"];
        }
      | undefined;

    const service = createWebsiteInquiryService({
      getTenantById: async () => {
        callOrder.push("resolve_tenant");
        return tenant;
      },
      getTenantBySlug: async () => {
        throw new Error(
          "tenant slug lookup should not run when tenantId is supplied"
        );
      },
      insertWebsiteInquiry: async (input) => {
        callOrder.push("insert_inquiry");
        insertedPayload = {
          tenantId: input.tenantId,
          eventDate: input.eventDate,
          guestCount: input.guestCount,
          summaryStatus: input.summaryStatus,
          rawPayload: input.rawPayload,
        };
        return inquiry;
      },
      insertAuditLog: async (input) => {
        callOrder.push(`audit:${input.eventType}`);
        auditEvents.push(input.eventType);
        return {} as never;
      },
      generateAndStoreWebsiteInquirySummary: async () => {
        callOrder.push("summarize_inquiry");
        return {
          inquiry: makeWebsiteInquiry({
            summary_status: "completed",
            summary_short: "Prospect asked about an October reception for 140 guests.",
            summary_key_facts: [
              "Event date: 2026-10-18",
              "Guest count: 140",
            ],
            summary_confidence: 0.92,
            summary_generated_at: "2026-04-11T18:01:10.000Z",
          }),
          summary: {
            status: "completed",
            detail: "AI inquiry summary stored successfully.",
            errorType: null,
          },
        };
      },
      syncWebsiteInquiry: async () => {
        callOrder.push("sync_downstream");
        throw new Error("GHL is unavailable");
      },
    });

    const result = await service.intakeWebsiteInquiry({
      tenantId: tenant.id,
      contactName: "Taylor Brooks",
      email: "Taylor@example.com",
      phone: " 555-555-0100 ",
      eventDate: "2026-10-18T20:00:00-04:00",
      guestCount: "140" as unknown as number,
      message: "Looking for availability for an October reception.",
      source: "Website_Form",
      rawPayload: {
        tenantId: tenant.id,
        campaign: "spring-launch",
      },
      observability: {
        requestId: "req-website-123",
        traceId: "trace-website-456",
      },
    });

    assert.equal(result.inquiry.id, inquiry.id);
    assert.equal(result.inquiry.summary_status, "completed");
    assert.equal(result.summary.status, "completed");
    assert.equal(result.summary.errorType, null);
    assert.equal(result.downstream.status, "failed");
    assert.equal(result.downstream.errorType, "unknown_error");
    assert.equal(result.tenant.id, tenant.id);
    assert.equal(insertedPayload?.tenantId, tenant.id);
    assert.equal(insertedPayload?.eventDate, "2026-10-18");
    assert.equal(insertedPayload?.guestCount, 140);
    assert.equal(insertedPayload?.summaryStatus, "pending");
    assert.deepEqual(insertedPayload?.rawPayload, {
      tenantId: tenant.id,
      campaign: "spring-launch",
    });
    assert.deepEqual(auditEvents, [
      "website_inquiry.persisted",
      "website_inquiry.sync_failed",
    ]);
    assert.equal(
      callOrder.indexOf("insert_inquiry") < callOrder.indexOf("summarize_inquiry"),
      true
    );
    assert.equal(
      callOrder.indexOf("summarize_inquiry") < callOrder.indexOf("sync_downstream"),
      true
    );
    assert.equal(
      callOrder.indexOf("insert_inquiry") < callOrder.indexOf("sync_downstream"),
      true
    );
  });

  it("keeps intake successful when summary generation fails", async () => {
    const tenant = makeTenant();
    const inquiry = makeWebsiteInquiry();

    const service = createWebsiteInquiryService({
      getTenantById: async () => tenant,
      getTenantBySlug: async () => null,
      insertWebsiteInquiry: async () => inquiry,
      insertAuditLog: async () => undefined,
      generateAndStoreWebsiteInquirySummary: async () => ({
        inquiry: makeWebsiteInquiry({
          summary_status: "failed",
          summary_metadata: {
            errorType: "timeout_error",
          },
        }),
        summary: {
          status: "failed",
          detail: "Summary model timed out.",
          errorType: "timeout_error",
        },
      }),
      syncWebsiteInquiry: async () => ({
        status: "skipped",
        detail: "No downstream website inquiry sync is configured.",
      }),
    });

    const result = await service.intakeWebsiteInquiry({
      tenantId: tenant.id,
      contactName: inquiry.contact_name,
      email: inquiry.email,
      phone: inquiry.phone,
      eventDate: inquiry.event_date,
      guestCount: inquiry.guest_count,
      message: inquiry.message,
      source: inquiry.source,
    });

    assert.equal(result.inquiry.id, inquiry.id);
    assert.equal(result.inquiry.summary_status, "failed");
    assert.equal(result.summary.status, "failed");
    assert.equal(result.summary.errorType, "timeout_error");
    assert.equal(result.downstream.status, "skipped");
  });
});
