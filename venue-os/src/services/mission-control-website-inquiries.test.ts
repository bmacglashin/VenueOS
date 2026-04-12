import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Database } from "@/src/lib/db/supabase";

import { createMissionControlWebsiteInquiryService } from "./mission-control-website-inquiries";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type WebsiteInquiry = Database["public"]["Tables"]["website_inquiries"]["Row"];

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "tenant-a",
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
    id: "inquiry-a",
    tenant_id: "tenant-a",
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
      utmCampaign: "spring-launch",
    },
    summary_status: "completed",
    summary_short: "October reception inquiry for 140 guests.",
    summary_key_facts: [
      "Event date: 2026-10-18",
      "Guest count: 140",
    ],
    summary_confidence: 0.91,
    summary_metadata: {
      llm: {
        model: "test-model",
      },
    },
    summary_generated_at: "2026-04-11T18:02:00.000Z",
    created_at: "2026-04-11T18:01:00.000Z",
    updated_at: "2026-04-11T18:02:00.000Z",
    ...overrides,
  };
}

describe("createMissionControlWebsiteInquiryService", () => {
  it("builds tenant-scoped inquiry detail with raw and summary data", async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant({
      id: "tenant-b",
      name: "Harborview Loft",
      slug: "harborview-loft",
      ghl_location_id: "loc-harborview",
    });
    const inquiryA = makeWebsiteInquiry();
    const inquiryB = makeWebsiteInquiry({
      id: "inquiry-b",
      tenant_id: tenantB.id,
      contact_name: "Morgan Lane",
      summary_status: "failed",
      summary_short: null,
      summary_key_facts: [],
      summary_confidence: null,
      summary_metadata: {
        errorType: "timeout_error",
      },
      summary_generated_at: null,
    });
    const tenants = new Map<string, Tenant>([
      [tenantA.id, tenantA],
      [tenantB.id, tenantB],
    ]);
    const inquiries = new Map<string, WebsiteInquiry>([
      [inquiryA.id, inquiryA],
      [inquiryB.id, inquiryB],
    ]);

    const service = createMissionControlWebsiteInquiryService({
      listTenants: async () => [tenantA, tenantB],
      getTenantById: async (tenantId) => tenants.get(tenantId) ?? null,
      listWebsiteInquiries: async ({ tenantId }) =>
        [...inquiries.values()].filter((inquiry) =>
          tenantId == null ? true : inquiry.tenant_id === tenantId
        ),
      getWebsiteInquiryById: async ({ inquiryId, tenantId }) => {
        const inquiry = inquiries.get(inquiryId) ?? null;

        if (inquiry == null) {
          return null;
        }

        return tenantId == null || inquiry.tenant_id === tenantId ? inquiry : null;
      },
    });

    const data = await service.getMissionControlWebsiteInquiryData({
      tenantId: tenantA.id,
      inquiryId: inquiryA.id,
    });

    assert.equal(data.selectedTenant?.id, tenantA.id);
    assert.deepEqual(data.inquiries.map((item) => item.inquiry.id), [inquiryA.id]);
    assert.equal(data.selectedInquiry?.tenant.name, tenantA.name);
    assert.equal(
      data.selectedInquiry?.summary.short,
      "October reception inquiry for 140 guests."
    );
    assert.deepEqual(data.selectedInquiry?.summary.keyFacts, [
      "Event date: 2026-10-18",
      "Guest count: 140",
    ]);
    assert.deepEqual(data.selectedInquiry?.inquiry.raw_payload, {
      tenantSlug: "veritas",
      utmCampaign: "spring-launch",
    });
    assert.equal(data.stats.inquiryCount, 1);
    assert.equal(data.stats.completedSummaryCount, 1);
    assert.equal(data.stats.failedSummaryCount, 0);
  });
});
