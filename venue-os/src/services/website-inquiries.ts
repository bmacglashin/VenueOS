import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/src/lib/db/supabase";
import {
  classifyOperationalError,
  createObservabilityContext,
  DatabaseError,
  getOperationalErrorMessage,
  ValidationError,
  type ObservabilityContext,
  type StructuredEventName,
} from "@/src/lib/observability";
import type { InsertAuditLogInput } from "@/src/services/audit-logs";
import type {
  GenerateAndStoreWebsiteInquirySummaryResult,
  WebsiteInquirySummaryStatus,
} from "@/src/services/website-inquiry-summaries";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type WebsiteInquiry = Database["public"]["Tables"]["website_inquiries"]["Row"];

const WEBSITE_INQUIRY_PERSISTED_EVENT = "website_inquiry.persisted";
const WEBSITE_INQUIRY_SYNC_FAILED_EVENT = "website_inquiry.sync_failed";

function normalizeEventDate(value: string): string | null {
  const trimmed = value.trim();
  const leadingDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);

  if (trimmed.length === 0) {
    return null;
  }

  if (leadingDateMatch != null) {
    const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
    return Number.isNaN(parsed.getTime()) ? null : leadingDateMatch[1];
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

const websiteInquiryBaseSchema = z
  .object({
    tenantId: z.string().uuid().optional(),
    tenantSlug: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.toLowerCase())
      .optional(),
    contactName: z.string().trim().min(1),
    email: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase()),
    phone: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => normalizeNullableText(value)),
    eventDate: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => normalizeEventDate(value) != null,
        "Event date must be YYYY-MM-DD or a valid ISO 8601 date."
      )
      .transform((value) => normalizeEventDate(value) as string),
    guestCount: z.coerce.number().int().positive(),
    message: z.string().trim().min(1),
    source: z.string().trim().min(1).transform((value) => value.toLowerCase()),
  })
  .superRefine((value, ctx) => {
    if (value.tenantId == null && value.tenantSlug == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tenantId"],
        message: "Either tenantId or tenantSlug is required.",
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tenantSlug"],
        message: "Either tenantId or tenantSlug is required.",
      });
    }
  });

export const websiteInquirySchema = websiteInquiryBaseSchema.passthrough();

export type WebsiteInquirySubmission = z.output<typeof websiteInquiryBaseSchema>;

export interface InsertWebsiteInquiryInput {
  tenantId: string;
  contactName: string;
  email: string;
  phone?: string | null;
  eventDate: string;
  guestCount: number;
  message: string;
  source: string;
  status?: string;
  summaryStatus?: WebsiteInquirySummaryStatus;
  rawPayload?: Json;
}

export interface ListWebsiteInquiriesInput {
  tenantId?: string;
  limit?: number;
}

export interface GetWebsiteInquiryByIdInput {
  inquiryId: string;
  tenantId?: string;
}

export interface IntakeWebsiteInquiryInput extends WebsiteInquirySubmission {
  rawPayload?: Json;
  observability?: ObservabilityContext;
}

export interface SyncWebsiteInquiryInput {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
  observability: ObservabilityContext;
}

export interface SyncWebsiteInquiryResult {
  status: "skipped" | "succeeded";
  detail: string;
}

export interface IntakeWebsiteInquiryResult {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
  observability: ObservabilityContext;
  summary: {
    status: WebsiteInquirySummaryStatus;
    detail: string;
    errorType: InsertAuditLogInput["errorType"] | null;
  };
  downstream: {
    status: "skipped" | "succeeded" | "failed";
    detail: string;
    errorType: InsertAuditLogInput["errorType"] | null;
  };
}

export interface WebsiteInquiryDependencies {
  getTenantById: (tenantId: string) => Promise<Tenant | null>;
  getTenantBySlug: (input: { slug: string }) => Promise<Tenant | null>;
  insertWebsiteInquiry: (
    input: InsertWebsiteInquiryInput
  ) => Promise<WebsiteInquiry>;
  insertAuditLog: (input: InsertAuditLogInput) => Promise<unknown>;
  generateAndStoreWebsiteInquirySummary: (input: {
    inquiry: WebsiteInquiry;
    tenant: Tenant;
    observability: ObservabilityContext;
  }) => Promise<GenerateAndStoreWebsiteInquirySummaryResult>;
  syncWebsiteInquiry: (
    input: SyncWebsiteInquiryInput
  ) => Promise<SyncWebsiteInquiryResult>;
}

function mustData<T>(result: PostgrestSingleResponse<T>, context: string): T {
  if (result.error != null) {
    throw new DatabaseError(`${context}: ${result.error.message}`, {
      cause: result.error,
    });
  }

  if (result.data == null) {
    throw new DatabaseError(`${context}: no data returned`);
  }

  return result.data;
}

async function getSupabaseAdminClient() {
  const { createSupabaseAdminClient } = await import("@/src/lib/db/admin");
  return createSupabaseAdminClient();
}

async function defaultGetTenantById(tenantId: string): Promise<Tenant | null> {
  const { getTenantById } = await import("@/src/services/conversations");
  return getTenantById(tenantId);
}

async function defaultGetTenantBySlug(input: {
  slug: string;
}): Promise<Tenant | null> {
  const { getTenantBySlug } = await import("@/src/services/conversations");
  return getTenantBySlug(input);
}

async function defaultInsertAuditLog(
  input: InsertAuditLogInput
): Promise<unknown> {
  const { insertAuditLog } = await import("@/src/services/audit-logs");
  return insertAuditLog(input);
}

async function defaultGenerateAndStoreWebsiteInquirySummary(input: {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
  observability: ObservabilityContext;
}): Promise<GenerateAndStoreWebsiteInquirySummaryResult> {
  const { generateAndStoreWebsiteInquirySummary } = await import(
    "@/src/services/website-inquiry-summaries"
  );
  return generateAndStoreWebsiteInquirySummary(input);
}

async function defaultSyncWebsiteInquiry(): Promise<SyncWebsiteInquiryResult> {
  return {
    status: "skipped",
    detail: "No downstream website inquiry sync is configured.",
  };
}

async function recordAuditLogSafely(
  deps: Pick<WebsiteInquiryDependencies, "insertAuditLog">,
  input: {
    tenantId: string;
    eventType: StructuredEventName;
    observability: ObservabilityContext;
    payload: Json;
    status?: string;
    errorType?: InsertAuditLogInput["errorType"];
  }
) {
  try {
    await deps.insertAuditLog({
      tenantId: input.tenantId,
      eventType: input.eventType,
      requestId: input.observability.requestId,
      traceId: input.observability.traceId,
      payload: input.payload,
      status: input.status,
      errorType: input.errorType ?? null,
    });
  } catch (error) {
    console.error("Failed to persist website inquiry audit log.", {
      tenantId: input.tenantId,
      eventType: input.eventType,
      requestId: input.observability.requestId,
      traceId: input.observability.traceId,
      error,
    });
  }
}

async function resolveTenant(
  deps: Pick<WebsiteInquiryDependencies, "getTenantById" | "getTenantBySlug">,
  input: WebsiteInquirySubmission
): Promise<Tenant> {
  const tenantById =
    input.tenantId == null ? null : await deps.getTenantById(input.tenantId);
  const tenantBySlug =
    input.tenantSlug == null
      ? null
      : await deps.getTenantBySlug({
          slug: input.tenantSlug,
        });

  if (input.tenantId != null && tenantById == null) {
    throw new ValidationError(`Tenant ${input.tenantId} was not found.`);
  }

  if (input.tenantSlug != null && tenantBySlug == null) {
    throw new ValidationError(`Tenant slug ${input.tenantSlug} was not found.`);
  }

  if (
    tenantById != null &&
    tenantBySlug != null &&
    tenantById.id !== tenantBySlug.id
  ) {
    throw new ValidationError(
      "tenantId and tenantSlug resolved to different tenants."
    );
  }

  const tenant = tenantById ?? tenantBySlug;

  if (tenant == null) {
    throw new ValidationError("A tenant reference is required.");
  }

  return tenant;
}

export async function insertWebsiteInquiry(
  input: InsertWebsiteInquiryInput
): Promise<WebsiteInquiry> {
  const supabase = await getSupabaseAdminClient();

  const created = await supabase
    .from("website_inquiries")
    .insert({
      tenant_id: input.tenantId,
      contact_name: input.contactName,
      email: input.email,
      phone: input.phone ?? null,
      event_date: input.eventDate,
      guest_count: input.guestCount,
      message: input.message,
      source: input.source,
      status: input.status ?? "received",
      summary_status: input.summaryStatus ?? "pending",
      raw_payload: input.rawPayload ?? {},
    })
    .select("*")
    .single();

  return mustData(created, "Failed to create website inquiry");
}

export async function listWebsiteInquiries(
  input: ListWebsiteInquiriesInput
): Promise<WebsiteInquiry[]> {
  const supabase = await getSupabaseAdminClient();
  let query = supabase
    .from("website_inquiries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 50);

  if (input.tenantId != null) {
    query = query.eq("tenant_id", input.tenantId);
  }

  const result = await query;

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to list website inquiries: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export async function getWebsiteInquiryById(
  input: GetWebsiteInquiryByIdInput
): Promise<WebsiteInquiry | null> {
  const supabase = await getSupabaseAdminClient();
  let query = supabase
    .from("website_inquiries")
    .select("*")
    .eq("id", input.inquiryId);

  if (input.tenantId != null) {
    query = query.eq("tenant_id", input.tenantId);
  }

  const result = await query.maybeSingle();

  if (result.error != null) {
    throw new DatabaseError(
      `Failed to fetch website inquiry ${input.inquiryId}: ${result.error.message}`,
      {
        cause: result.error,
      }
    );
  }

  return result.data;
}

export function createWebsiteInquiryService(
  overrides: Partial<WebsiteInquiryDependencies> = {}
) {
  const deps: WebsiteInquiryDependencies = {
    getTenantById: defaultGetTenantById,
    getTenantBySlug: defaultGetTenantBySlug,
    insertWebsiteInquiry,
    insertAuditLog: defaultInsertAuditLog,
    generateAndStoreWebsiteInquirySummary:
      defaultGenerateAndStoreWebsiteInquirySummary,
    syncWebsiteInquiry: defaultSyncWebsiteInquiry,
    ...overrides,
  };

  async function intakeWebsiteInquiry(
    input: IntakeWebsiteInquiryInput
  ): Promise<IntakeWebsiteInquiryResult> {
    const normalized = websiteInquiryBaseSchema.parse(input);
    const observability = createObservabilityContext(input.observability);
    const tenant = await resolveTenant(deps, normalized);
    const rawPayload = input.rawPayload ?? toJsonValue(input);

    const inquiry = await deps.insertWebsiteInquiry({
      tenantId: tenant.id,
      contactName: normalized.contactName,
      email: normalized.email,
      phone: normalized.phone,
      eventDate: normalized.eventDate,
      guestCount: normalized.guestCount,
      message: normalized.message,
      source: normalized.source,
      status: "received",
      summaryStatus: "pending",
      rawPayload,
    });

    await recordAuditLogSafely(deps, {
      tenantId: tenant.id,
      eventType: WEBSITE_INQUIRY_PERSISTED_EVENT,
      observability,
      status: "recorded",
      payload: toJsonValue({
        inquiryId: inquiry.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        source: inquiry.source,
        status: inquiry.status,
        eventDate: inquiry.event_date,
        guestCount: inquiry.guest_count,
      }),
    });

    let summarizedInquiry = inquiry;
    let summaryResult: GenerateAndStoreWebsiteInquirySummaryResult["summary"] = {
      status: "failed",
      detail: "AI inquiry summary did not run.",
      errorType: "unknown_error",
    };

    try {
      const generatedSummary = await deps.generateAndStoreWebsiteInquirySummary({
        inquiry,
        tenant,
        observability,
      });
      summarizedInquiry = generatedSummary.inquiry;
      summaryResult = generatedSummary.summary;
    } catch (error) {
      summaryResult = {
        status: "failed",
        detail: getOperationalErrorMessage(error),
        errorType: classifyOperationalError(error),
      };
    }

    try {
      const syncResult = await deps.syncWebsiteInquiry({
        inquiry: summarizedInquiry,
        tenant,
        observability,
      });

      return {
        inquiry: summarizedInquiry,
        tenant,
        observability,
        summary: summaryResult,
        downstream: {
          status: syncResult.status,
          detail: syncResult.detail,
          errorType: null,
        },
      };
    } catch (error) {
      const errorType = classifyOperationalError(error);
      const detail = getOperationalErrorMessage(error);

      await recordAuditLogSafely(deps, {
        tenantId: tenant.id,
        eventType: WEBSITE_INQUIRY_SYNC_FAILED_EVENT,
        observability,
        status: "deferred",
        errorType,
        payload: toJsonValue({
          inquiryId: inquiry.id,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          source: inquiry.source,
          errorType,
          error: detail,
        }),
      });

      return {
        inquiry: summarizedInquiry,
        tenant,
        observability,
        summary: summaryResult,
        downstream: {
          status: "failed",
          detail,
          errorType,
        },
      };
    }
  }

  return {
    intakeWebsiteInquiry,
  };
}

const websiteInquiryService = createWebsiteInquiryService();

export const intakeWebsiteInquiry =
  websiteInquiryService.intakeWebsiteInquiry;
