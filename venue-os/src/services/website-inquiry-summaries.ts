import { z } from "zod";

import type { Database, Json } from "@/src/lib/db/supabase";
import {
  classifyOperationalError,
  getOperationalErrorMessage,
  type ObservabilityContext,
  type OperationalErrorType,
  type StructuredEventName,
} from "@/src/lib/observability";
import type { InsertAuditLogInput } from "@/src/services/audit-logs";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type WebsiteInquiry = Database["public"]["Tables"]["website_inquiries"]["Row"];

const WEBSITE_INQUIRY_SUMMARY_COMPLETED_EVENT =
  "website_inquiry.summary_completed";
const WEBSITE_INQUIRY_SUMMARY_FAILED_EVENT = "website_inquiry.summary_failed";

export const WEBSITE_INQUIRY_SUMMARY_STATUSES = [
  "pending",
  "completed",
  "failed",
  "skipped",
] as const;

export type WebsiteInquirySummaryStatus =
  (typeof WEBSITE_INQUIRY_SUMMARY_STATUSES)[number];

const websiteInquirySummarySchema = z.object({
  shortSummary: z.string().trim().min(1).max(280),
  keyFacts: z.array(z.string().trim().min(1).max(180)).min(1).max(6),
  confidence: z.number().min(0).max(1),
});

type GeneratedWebsiteInquirySummary = z.infer<typeof websiteInquirySummarySchema>;

export interface UpdateWebsiteInquirySummaryInput {
  inquiryId: string;
  summaryStatus: WebsiteInquirySummaryStatus;
  summaryShort?: string | null;
  summaryKeyFacts?: string[];
  summaryConfidence?: number | null;
  summaryMetadata?: Json;
  summaryGeneratedAt?: string | null;
}

export interface GenerateAndStoreWebsiteInquirySummaryInput {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
  observability: ObservabilityContext;
}

export interface GenerateAndStoreWebsiteInquirySummaryResult {
  inquiry: WebsiteInquiry;
  summary: {
    status: WebsiteInquirySummaryStatus;
    detail: string;
    errorType: OperationalErrorType | null;
  };
}

export interface WebsiteInquirySummaryDependencies {
  generateSummaryObject: (input: {
    inquiry: WebsiteInquiry;
    tenant: Tenant;
  }) => Promise<{
    summary: GeneratedWebsiteInquirySummary;
    metadata: Json;
  }>;
  updateWebsiteInquirySummary: (
    input: UpdateWebsiteInquirySummaryInput
  ) => Promise<WebsiteInquiry>;
  insertAuditLog: (input: InsertAuditLogInput) => Promise<unknown>;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

async function getSupabaseAdminClient() {
  const { createSupabaseAdminClient } = await import("@/src/lib/db/admin");
  return createSupabaseAdminClient();
}

async function defaultGenerateSummaryObject(input: {
  inquiry: WebsiteInquiry;
  tenant: Tenant;
}): Promise<{
  summary: GeneratedWebsiteInquirySummary;
  metadata: Json;
}> {
  const { runVenueStructuredOutput } = await import("@/src/services/ai");

  const result = await runVenueStructuredOutput({
    purpose: "website_inquiry_summary",
    schema: websiteInquirySummarySchema,
    schemaName: "websiteInquirySummary",
    schemaDescription:
      "A concise operator-facing summary of a persisted website inquiry.",
    temperature: 0,
    system: [
      "You summarize persisted venue website inquiries for Mission Control operators.",
      "Return a short factual summary, extracted key facts, and a confidence score.",
      "Use only the supplied inquiry data and raw payload.",
      "Do not invent pricing, availability, or venue policy details.",
      "Keep the summary concise and useful for quick triage.",
    ].join("\n"),
    prompt: [
      `Venue tenant: ${input.tenant.name}`,
      `Inquiry ID: ${input.inquiry.id}`,
      `Contact name: ${input.inquiry.contact_name}`,
      `Email: ${input.inquiry.email}`,
      `Phone: ${input.inquiry.phone ?? "Not provided"}`,
      `Event date: ${input.inquiry.event_date}`,
      `Guest count: ${input.inquiry.guest_count}`,
      `Source: ${input.inquiry.source}`,
      `Created at: ${input.inquiry.created_at}`,
      "",
      "Message:",
      input.inquiry.message,
      "",
      "Raw payload:",
      JSON.stringify(input.inquiry.raw_payload, null, 2),
    ].join("\n"),
  });

  return {
    summary: result.object,
    metadata: toJsonValue({
      llm: result.metadata,
    }),
  };
}

export async function updateWebsiteInquirySummary(
  input: UpdateWebsiteInquirySummaryInput
): Promise<WebsiteInquiry> {
  const supabase = await getSupabaseAdminClient();
  const result = await supabase
    .from("website_inquiries")
    .update({
      summary_status: input.summaryStatus,
      summary_short: input.summaryShort ?? null,
      summary_key_facts: toJsonValue(input.summaryKeyFacts ?? []),
      summary_confidence: input.summaryConfidence ?? null,
      summary_metadata: input.summaryMetadata ?? {},
      summary_generated_at: input.summaryGeneratedAt ?? null,
    })
    .eq("id", input.inquiryId)
    .select("*")
    .single();

  if (result.error != null || result.data == null) {
    throw new Error(
      `Failed to update website inquiry summary for ${input.inquiryId}: ${result.error?.message ?? "no data returned"}`
    );
  }

  return result.data;
}

async function defaultInsertAuditLog(
  input: InsertAuditLogInput
): Promise<unknown> {
  const { insertAuditLog } = await import("@/src/services/audit-logs");
  return insertAuditLog(input);
}

async function recordAuditLogSafely(
  deps: Pick<WebsiteInquirySummaryDependencies, "insertAuditLog">,
  input: {
    tenantId: string;
    observability: ObservabilityContext;
    eventType: StructuredEventName;
    payload: Json;
    status: string;
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
    console.error("Failed to persist website inquiry summary audit log.", {
      tenantId: input.tenantId,
      eventType: input.eventType,
      requestId: input.observability.requestId,
      traceId: input.observability.traceId,
      error,
    });
  }
}

export function createWebsiteInquirySummaryService(
  overrides: Partial<WebsiteInquirySummaryDependencies> = {}
) {
  const deps: WebsiteInquirySummaryDependencies = {
    generateSummaryObject: defaultGenerateSummaryObject,
    updateWebsiteInquirySummary,
    insertAuditLog: defaultInsertAuditLog,
    ...overrides,
  };

  async function generateAndStoreWebsiteInquirySummary(
    input: GenerateAndStoreWebsiteInquirySummaryInput
  ): Promise<GenerateAndStoreWebsiteInquirySummaryResult> {
    try {
      const generated = await deps.generateSummaryObject({
        inquiry: input.inquiry,
        tenant: input.tenant,
      });
      const updatedInquiry = await deps.updateWebsiteInquirySummary({
        inquiryId: input.inquiry.id,
        summaryStatus: "completed",
        summaryShort: generated.summary.shortSummary,
        summaryKeyFacts: generated.summary.keyFacts,
        summaryConfidence: generated.summary.confidence,
        summaryMetadata: generated.metadata,
        summaryGeneratedAt: new Date().toISOString(),
      });

      await recordAuditLogSafely(deps, {
        tenantId: input.tenant.id,
        observability: input.observability,
        eventType: WEBSITE_INQUIRY_SUMMARY_COMPLETED_EVENT,
        status: "recorded",
        payload: toJsonValue({
          inquiryId: updatedInquiry.id,
          summaryStatus: updatedInquiry.summary_status,
          summaryConfidence: updatedInquiry.summary_confidence,
        }),
      });

      return {
        inquiry: updatedInquiry,
        summary: {
          status: "completed",
          detail: "AI inquiry summary stored successfully.",
          errorType: null,
        },
      };
    } catch (error) {
      const errorType = classifyOperationalError(error);
      const detail = getOperationalErrorMessage(error);

      let updatedInquiry = input.inquiry;

      try {
        updatedInquiry = await deps.updateWebsiteInquirySummary({
          inquiryId: input.inquiry.id,
          summaryStatus: "failed",
          summaryShort: null,
          summaryKeyFacts: [],
          summaryConfidence: null,
          summaryMetadata: toJsonValue({
            errorType,
            error: detail,
          }),
          summaryGeneratedAt: null,
        });
      } catch (updateError) {
        console.error("Failed to persist website inquiry summary failure state.", {
          inquiryId: input.inquiry.id,
          tenantId: input.tenant.id,
          error: updateError,
        });
      }

      await recordAuditLogSafely(deps, {
        tenantId: input.tenant.id,
        observability: input.observability,
        eventType: WEBSITE_INQUIRY_SUMMARY_FAILED_EVENT,
        status: "deferred",
        errorType,
        payload: toJsonValue({
          inquiryId: input.inquiry.id,
          summaryStatus: "failed",
          errorType,
          error: detail,
        }),
      });

      return {
        inquiry: updatedInquiry,
        summary: {
          status: "failed",
          detail,
          errorType,
        },
      };
    }
  }

  return {
    generateAndStoreWebsiteInquirySummary,
  };
}

const websiteInquirySummaryService = createWebsiteInquirySummaryService();

export const generateAndStoreWebsiteInquirySummary =
  websiteInquirySummaryService.generateAndStoreWebsiteInquirySummary;
