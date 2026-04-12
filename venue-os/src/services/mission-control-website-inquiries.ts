import type { Database, Json } from "@/src/lib/db/supabase";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type WebsiteInquiry = Database["public"]["Tables"]["website_inquiries"]["Row"];

const WEBSITE_INQUIRY_LIST_LIMIT = 40;

export interface MissionControlWebsiteInquiryListItem {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
}

export interface MissionControlWebsiteInquiryDetail {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
  summary: {
    status: string;
    short: string | null;
    keyFacts: string[];
    confidence: number | null;
    metadata: Json;
    generatedAt: string | null;
  };
}

export interface MissionControlWebsiteInquiryStats {
  inquiryCount: number;
  completedSummaryCount: number;
  failedSummaryCount: number;
  pendingSummaryCount: number;
}

export interface MissionControlWebsiteInquiryData {
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  inquiries: MissionControlWebsiteInquiryListItem[];
  selectedInquiry: MissionControlWebsiteInquiryDetail | null;
  stats: MissionControlWebsiteInquiryStats;
}

export interface GetMissionControlWebsiteInquiryDataInput {
  tenantId?: string;
  inquiryId?: string;
}

export interface MissionControlWebsiteInquiryDependencies {
  listTenants: (input: { limit?: number }) => Promise<Tenant[]>;
  getTenantById: (tenantId: string) => Promise<Tenant | null>;
  listWebsiteInquiries: (input: {
    tenantId?: string;
    limit?: number;
  }) => Promise<WebsiteInquiry[]>;
  getWebsiteInquiryById: (input: {
    inquiryId: string;
    tenantId?: string;
  }) => Promise<WebsiteInquiry | null>;
}

function readStringArray(value: Json): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "string") {
      return [];
    }

    const trimmed = item.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });
}

function buildWebsiteInquiryDetail(
  inquiry: WebsiteInquiry,
  tenant: Tenant
): MissionControlWebsiteInquiryDetail {
  return {
    inquiry,
    tenant,
    summary: {
      status: inquiry.summary_status,
      short: inquiry.summary_short,
      keyFacts: readStringArray(inquiry.summary_key_facts),
      confidence: inquiry.summary_confidence,
      metadata: inquiry.summary_metadata,
      generatedAt: inquiry.summary_generated_at,
    },
  };
}

function buildStats(
  inquiries: readonly MissionControlWebsiteInquiryListItem[]
): MissionControlWebsiteInquiryStats {
  return {
    inquiryCount: inquiries.length,
    completedSummaryCount: inquiries.filter(
      (item) => item.inquiry.summary_status === "completed"
    ).length,
    failedSummaryCount: inquiries.filter(
      (item) => item.inquiry.summary_status === "failed"
    ).length,
    pendingSummaryCount: inquiries.filter(
      (item) => item.inquiry.summary_status === "pending"
    ).length,
  };
}

async function defaultListTenants(input: {
  limit?: number;
}): Promise<Tenant[]> {
  const { listTenants } = await import("@/src/services/conversations");
  return listTenants(input);
}

async function defaultGetTenantById(tenantId: string): Promise<Tenant | null> {
  const { getTenantById } = await import("@/src/services/conversations");
  return getTenantById(tenantId);
}

async function defaultListWebsiteInquiries(input: {
  tenantId?: string;
  limit?: number;
}): Promise<WebsiteInquiry[]> {
  const { listWebsiteInquiries } = await import("@/src/services/website-inquiries");
  return listWebsiteInquiries(input);
}

async function defaultGetWebsiteInquiryById(input: {
  inquiryId: string;
  tenantId?: string;
}): Promise<WebsiteInquiry | null> {
  const { getWebsiteInquiryById } = await import("@/src/services/website-inquiries");
  return getWebsiteInquiryById(input);
}

export function createMissionControlWebsiteInquiryService(
  overrides: Partial<MissionControlWebsiteInquiryDependencies> = {}
) {
  const deps: MissionControlWebsiteInquiryDependencies = {
    listTenants: defaultListTenants,
    getTenantById: defaultGetTenantById,
    listWebsiteInquiries: defaultListWebsiteInquiries,
    getWebsiteInquiryById: defaultGetWebsiteInquiryById,
    ...overrides,
  };

  async function getMissionControlWebsiteInquiryData(
    input: GetMissionControlWebsiteInquiryDataInput = {}
  ): Promise<MissionControlWebsiteInquiryData> {
    const tenants = await deps.listTenants({
      limit: 100,
    });
    const selectedTenant =
      input.tenantId == null
        ? null
        : tenants.find((tenant) => tenant.id === input.tenantId) ?? null;
    const inquiries = await deps.listWebsiteInquiries({
      tenantId: selectedTenant?.id,
      limit: WEBSITE_INQUIRY_LIST_LIMIT,
    });
    const tenantIds = [...new Set(inquiries.map((inquiry) => inquiry.tenant_id))];
    const inquiryTenants = new Map<string, Tenant>();

    await Promise.all(
      tenantIds.map(async (tenantId) => {
        const tenant = await deps.getTenantById(tenantId);

        if (tenant != null) {
          inquiryTenants.set(tenant.id, tenant);
        }
      })
    );

    const listItems = inquiries.flatMap((inquiry) => {
      const tenant = inquiryTenants.get(inquiry.tenant_id);
      return tenant == null ? [] : [{ inquiry, tenant }];
    });

    const selectedInquiryRecord =
      input.inquiryId == null
        ? listItems[0]?.inquiry ?? null
        : await deps.getWebsiteInquiryById({
            inquiryId: input.inquiryId,
            tenantId: selectedTenant?.id,
          });

    const selectedInquiryTenant =
      selectedInquiryRecord == null
        ? null
        : inquiryTenants.get(selectedInquiryRecord.tenant_id) ??
          (await deps.getTenantById(selectedInquiryRecord.tenant_id));

    return {
      tenants,
      selectedTenant,
      inquiries: listItems,
      selectedInquiry:
        selectedInquiryRecord != null && selectedInquiryTenant != null
          ? buildWebsiteInquiryDetail(selectedInquiryRecord, selectedInquiryTenant)
          : null,
      stats: buildStats(listItems),
    };
  }

  return {
    getMissionControlWebsiteInquiryData,
  };
}

const missionControlWebsiteInquiryService =
  createMissionControlWebsiteInquiryService();

export const getMissionControlWebsiteInquiryData =
  missionControlWebsiteInquiryService.getMissionControlWebsiteInquiryData;
