import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createHealthGetHandler } from "./handler";

describe("createHealthGetHandler", () => {
  it("returns a ready response with observability IDs", async () => {
    const GET = createHealthGetHandler({
      getSystemHealthStatus: async () => ({
        live: true,
        ready: true,
        status: "ready",
        generatedAt: "2026-04-11T14:10:00.000Z",
        checks: {
          configuration: {
            ok: true,
            detail: "All required runtime environment variables are configured and valid.",
            missingRequired: [],
            invalidRequired: [],
            missingOptional: [],
          },
          database: {
            ok: true,
            detail: "Supabase responded to a lightweight audit log query.",
          },
        },
      }),
    });

    const response = await GET(
      new Request("https://example.test/api/health", {
        headers: {
          "x-request-id": "req-health-123",
          "x-trace-id": "trace-health-456",
        },
      })
    );
    const body = (await response.json()) as {
      ready: boolean;
      requestId: string;
      traceId: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ready, true);
    assert.equal(body.requestId, "req-health-123");
    assert.equal(body.traceId, "trace-health-456");
  });

  it("returns 503 when readiness checks are degraded", async () => {
    const GET = createHealthGetHandler({
      getSystemHealthStatus: async () => ({
        live: true,
        ready: false,
        status: "degraded",
        generatedAt: "2026-04-11T14:10:00.000Z",
        checks: {
          configuration: {
            ok: false,
            detail: "Missing required environment variables: GHL_API_KEY",
            missingRequired: ["GHL_API_KEY"],
            invalidRequired: [],
            missingOptional: ["OPS_STATUS_TOKEN"],
          },
          database: {
            ok: true,
            detail: "Supabase responded to a lightweight audit log query.",
          },
        },
      }),
    });

    const response = await GET(new Request("https://example.test/api/health"));
    const body = (await response.json()) as {
      status: string;
      ready: boolean;
    };

    assert.equal(response.status, 503);
    assert.equal(body.status, "degraded");
    assert.equal(body.ready, false);
  });
});
