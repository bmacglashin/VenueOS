import { NextResponse } from "next/server";

import {
  applyObservabilityHeaders,
  classifyOperationalError,
  createObservabilityContextFromHeaders,
} from "@/src/lib/observability";

export interface OpsStatusRouteDependencies {
  authorizeOpsStatusRequest: (headers: Headers) => {
    ok: boolean;
    reason: "authorized" | "missing_token_config" | "unauthorized";
  };
  getOpsStatus: () => Promise<{
    generatedAt: string;
    counters: {
      inboundReceived: number;
      reviewQueued: number;
      outboundSent: number;
      outboundBlocked: number;
      outboundFailed: number;
      duplicateDropped: number;
    };
    lastAuditLogAt: string | null;
  }>;
  getSystemHealthStatus: () => Promise<{
    live: true;
    ready: boolean;
    status: "ready" | "degraded";
    generatedAt: string;
    checks: {
      configuration: {
        ok: boolean;
        detail: string;
        missingRequired: string[];
        missingOptional: string[];
      };
      database: {
        ok: boolean;
        detail: string;
      };
    };
  }>;
}

export function createOpsStatusGetHandler(
  deps: OpsStatusRouteDependencies
) {
  return async function GET(req: Request) {
    const observability = createObservabilityContextFromHeaders(req.headers);
    const headers = applyObservabilityHeaders(new Headers(), observability);
    const access = deps.authorizeOpsStatusRequest(req.headers);

    if (!access.ok) {
      return NextResponse.json(
        {
          success: false,
          requestId: observability.requestId,
          traceId: observability.traceId,
          error:
            access.reason === "missing_token_config"
              ? "OPS_STATUS_TOKEN is not configured."
              : "Unauthorized.",
        },
        {
          status: access.reason === "missing_token_config" ? 503 : 401,
          headers,
        }
      );
    }

    try {
      const [opsStatus, health] = await Promise.all([
        deps.getOpsStatus(),
        deps.getSystemHealthStatus(),
      ]);

      return NextResponse.json(
        {
          success: true,
          requestId: observability.requestId,
          traceId: observability.traceId,
          ...opsStatus,
          health: {
            ready: health.ready,
            status: health.status,
          },
        },
        {
          status: 200,
          headers,
        }
      );
    } catch (error) {
      const errorType = classifyOperationalError(error);

      return NextResponse.json(
        {
          success: false,
          requestId: observability.requestId,
          traceId: observability.traceId,
          errorType,
          error:
            error instanceof Error
              ? error.message
              : "Failed to build ops status response.",
        },
        {
          status:
            errorType === "config_error" || errorType === "db_error" ? 503 : 500,
          headers,
        }
      );
    }
  };
}
