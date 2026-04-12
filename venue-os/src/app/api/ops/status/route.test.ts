import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOpsStatusGetHandler } from "./handler";

describe("createOpsStatusGetHandler", () => {
  it("rejects unauthorized requests", async () => {
    const GET = createOpsStatusGetHandler({
      authorizeOpsStatusRequest: () => ({
        ok: false,
        reason: "unauthorized",
      }),
      getOpsStatus: async () => {
        throw new Error("unauthorized requests should not read counters");
      },
      getSystemHealthStatus: async () => ({
        live: true,
        ready: true,
        status: "ready",
        generatedAt: "2026-04-11T14:15:00.000Z",
        checks: {
          configuration: {
            ok: true,
            detail: "configured",
            missingRequired: [],
            invalidRequired: [],
            missingOptional: [],
          },
          database: {
            ok: true,
            detail: "connected",
          },
        },
      }),
    });

    const response = await GET(new Request("https://example.test/api/ops/status"));
    const body = (await response.json()) as {
      success: boolean;
      error: string;
    };

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.error, "Unauthorized.");
  });

  it("returns counters for authorized requests", async () => {
    const GET = createOpsStatusGetHandler({
      authorizeOpsStatusRequest: () => ({
        ok: true,
        reason: "authorized",
      }),
      getOpsStatus: async () => ({
        generatedAt: "2026-04-11T14:15:00.000Z",
        counters: {
          inboundReceived: 12,
          reviewQueued: 4,
          outboundSent: 3,
          outboundBlocked: 2,
          outboundFailed: 1,
          duplicateDropped: 5,
        },
        lastAuditLogAt: "2026-04-11T14:14:59.000Z",
      }),
      getSystemHealthStatus: async () => ({
        live: true,
        ready: true,
        status: "ready",
        generatedAt: "2026-04-11T14:15:00.000Z",
        checks: {
          configuration: {
            ok: true,
            detail: "configured",
            missingRequired: [],
            invalidRequired: [],
            missingOptional: [],
          },
          database: {
            ok: true,
            detail: "connected",
          },
        },
      }),
    });

    const response = await GET(
      new Request("https://example.test/api/ops/status", {
        headers: {
          authorization: "Bearer test-token",
          "x-request-id": "req-ops-123",
        },
      })
    );
    const body = (await response.json()) as {
      success: boolean;
      requestId: string;
      counters: {
        duplicateDropped: number;
        outboundBlocked: number;
      };
      health: {
        ready: boolean;
        status: string;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.requestId, "req-ops-123");
    assert.equal(body.counters.duplicateDropped, 5);
    assert.equal(body.counters.outboundBlocked, 2);
    assert.equal(body.health.ready, true);
    assert.equal(body.health.status, "ready");
  });
});
