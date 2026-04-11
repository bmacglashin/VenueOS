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
          rawPayload: input.rawPayload,
        };
        return inquiry;
      },
      insertAuditLog: async (input) => {
        callOrder.push(`audit:${input.eventType}`);
        auditEvents.push(input.eventType);
        return {} as never;
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
    assert.equal(result.downstream.status, "failed");
    assert.equal(result.downstream.errorType, "unknown_error");
    assert.equal(result.tenant.id, tenant.id);
    assert.equal(insertedPayload?.tenantId, tenant.id);
    assert.equal(insertedPayload?.eventDate, "2026-10-18");
    assert.equal(insertedPayload?.guestCount, 140);
    assert.deepEqual(insertedPayload?.rawPayload, {
      tenantId: tenant.id,
      campaign: "spring-launch",
    });
    assert.deepEqual(auditEvents, [
      "website_inquiry.persisted",
      "website_inquiry.sync_failed",
    ]);
    assert.equal(
      callOrder.indexOf("insert_inquiry") < callOrder.indexOf("sync_downstream"),
      true
    );
  });
});
