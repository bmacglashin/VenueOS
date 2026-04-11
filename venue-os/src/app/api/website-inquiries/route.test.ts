import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "@/src/lib/db/supabase";

import { createWebsiteInquiryPostHandler } from "./handler";

type WebsiteInquiry = Database["public"]["Tables"]["website_inquiries"]["Row"];
type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "00000000-0000-0000-0000-000000000201",
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
    tenant_id: "00000000-0000-0000-0000-000000000201",
    contact_name: "Taylor Brooks",
    email: "taylor@example.com",
    phone: "555-555-0100",
    event_date: "2026-10-18",
    guest_count: 140,
    message: "Looking for availability for an October reception.",
    source: "website_form",
    status: "received",
    raw_payload: {},
    created_at: "2026-04-11T18:01:00.000Z",
    updated_at: "2026-04-11T18:01:00.000Z",
    ...overrides,
  };
}

describe("createWebsiteInquiryPostHandler", () => {
  it("returns field-level schema errors for invalid payloads", async () => {
    let intakeCalled = false;

    const POST = createWebsiteInquiryPostHandler({
      intakeWebsiteInquiry: async () => {
        intakeCalled = true;
        throw new Error("should not be called");
      },
    });

    const response = await POST(
      new Request("https://example.test/api/website-inquiries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-invalid-website-123",
        },
        body: JSON.stringify({
          tenantSlug: "veritas",
          contactName: "Taylor Brooks",
          email: "not-an-email",
          guestCount: 0,
          source: "website_form",
        }),
      })
    );
    const body = (await response.json()) as {
      success: boolean;
      errorType: string;
      errors: Array<{ path: string; message: string }>;
    };

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.errorType, "validation_error");
    assert.equal(intakeCalled, false);
    assert.deepEqual(
      body.errors.map((issue) => issue.path).sort(),
      ["email", "eventDate", "guestCount", "message"]
    );
  });

  it("returns created inquiry details and a non-blocking downstream failure state", async () => {
    const tenant = makeTenant();
    const inquiry = makeWebsiteInquiry();

    const POST = createWebsiteInquiryPostHandler({
      intakeWebsiteInquiry: async (input) => {
        assert.equal(input.tenantSlug, "veritas");
        assert.equal(input.source, "website_form");
        return {
          inquiry,
          tenant,
          observability: {
            requestId: "req-created-website-123",
            traceId: "trace-created-website-456",
          },
          downstream: {
            status: "failed",
            detail: "GHL is unavailable",
            errorType: "external_api_error",
          },
        };
      },
    });

    const response = await POST(
      new Request("https://example.test/api/website-inquiries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenantSlug: "veritas",
          contactName: "Taylor Brooks",
          email: "taylor@example.com",
          phone: "555-555-0100",
          eventDate: "2026-10-18",
          guestCount: 140,
          message: "Looking for availability for an October reception.",
          source: "website_form",
        }),
      })
    );
    const body = (await response.json()) as {
      success: boolean;
      inquiry: {
        tenantSlug: string;
        status: string;
      };
      downstream: {
        status: string;
        errorType: string | null;
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.inquiry.tenantSlug, "veritas");
    assert.equal(body.inquiry.status, "received");
    assert.equal(body.downstream.status, "failed");
    assert.equal(body.downstream.errorType, "external_api_error");
  });
});
