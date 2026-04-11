import { NextResponse } from "next/server";

import {
  applyObservabilityHeaders,
  createObservabilityContextFromHeaders,
} from "@/src/lib/observability";

export interface HealthRouteDependencies {
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

export function createHealthGetHandler(
  deps: HealthRouteDependencies
) {
  return async function GET(req: Request) {
    const observability = createObservabilityContextFromHeaders(req.headers);
    const health = await deps.getSystemHealthStatus();
    const headers = applyObservabilityHeaders(new Headers(), observability);

    return NextResponse.json(
      {
        ...health,
        requestId: observability.requestId,
        traceId: observability.traceId,
      },
      {
        status: health.ready ? 200 : 503,
        headers,
      }
    );
  };
}
