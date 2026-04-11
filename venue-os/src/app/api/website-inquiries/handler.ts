import { NextResponse } from "next/server";
import type { ZodIssue } from "zod";

import type { Json } from "@/src/lib/db/supabase";
import {
  applyObservabilityHeaders,
  classifyOperationalError,
  createObservabilityContextFromHeaders,
  getOperationalErrorMessage,
} from "@/src/lib/observability";
import {
  websiteInquirySchema,
  type IntakeWebsiteInquiryResult,
  type WebsiteInquirySubmission,
} from "@/src/services/website-inquiries";

export interface WebsiteInquiryRouteDependencies {
  intakeWebsiteInquiry: (
    input: WebsiteInquirySubmission & {
      rawPayload?: Json;
      observability?: {
        requestId: string;
        traceId: string;
      };
    }
  ) => Promise<IntakeWebsiteInquiryResult>;
}

interface ValidationIssue {
  path: string;
  message: string;
}

function formatValidationIssues(issues: readonly ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join(".") || "body",
    message: issue.message,
  }));
}

function buildJsonResponse(
  body: Record<string, unknown>,
  status: number,
  observability: { requestId: string; traceId: string }
) {
  const headers = applyObservabilityHeaders(new Headers(), observability);

  return NextResponse.json(
    {
      ...body,
      requestId: observability.requestId,
      traceId: observability.traceId,
    },
    {
      status,
      headers,
    }
  );
}

async function parseRequestBody(req: Request): Promise<unknown> {
  const rawBody = await req.text();

  if (rawBody.trim().length === 0) {
    throw new SyntaxError("Request body must be valid JSON.");
  }

  return JSON.parse(rawBody) as unknown;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export function createWebsiteInquiryPostHandler(
  deps: WebsiteInquiryRouteDependencies
) {
  return async function POST(req: Request) {
    const observability = createObservabilityContextFromHeaders(req.headers);

    let payload: unknown;

    try {
      payload = await parseRequestBody(req);
    } catch (error) {
      return buildJsonResponse(
        {
          success: false,
          errorType: "validation_error",
          message: "Request body must be valid JSON.",
          errors: [
            {
              path: "body",
              message: getOperationalErrorMessage(error),
            },
          ],
        },
        400,
        observability
      );
    }

    const parsedBody = websiteInquirySchema.safeParse(payload);

    if (!parsedBody.success) {
      return buildJsonResponse(
        {
          success: false,
          errorType: "validation_error",
          message: "Website inquiry payload failed schema validation.",
          errors: formatValidationIssues(parsedBody.error.issues),
        },
        400,
        observability
      );
    }

    try {
      const result = await deps.intakeWebsiteInquiry({
        ...parsedBody.data,
        rawPayload: toJsonValue(payload),
        observability,
      });

      return buildJsonResponse(
        {
          success: true,
          inquiry: {
            id: result.inquiry.id,
            tenantId: result.inquiry.tenant_id,
            tenantSlug: result.tenant.slug,
            contactName: result.inquiry.contact_name,
            email: result.inquiry.email,
            phone: result.inquiry.phone,
            eventDate: result.inquiry.event_date,
            guestCount: result.inquiry.guest_count,
            message: result.inquiry.message,
            source: result.inquiry.source,
            status: result.inquiry.status,
            createdAt: result.inquiry.created_at,
          },
          downstream: result.downstream,
        },
        201,
        result.observability
      );
    } catch (error) {
      const errorType = classifyOperationalError(error);

      return buildJsonResponse(
        {
          success: false,
          errorType,
          message:
            errorType === "validation_error"
              ? getOperationalErrorMessage(error)
              : "Website inquiry could not be recorded.",
        },
        errorType === "validation_error" ? 400 : 500,
        observability
      );
    }
  };
}
