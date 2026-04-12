import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError } from "@/src/lib/observability";

import { executeGhlWrite, type GhlExecutionLogger } from "./ghl-execution";

const OBSERVABILITY = {
  requestId: "req-ghl-123",
  traceId: "trace-ghl-456",
};

function makeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    GHL_EXECUTION_MODE: "dry_run",
    GHL_WRITE_KILL_SWITCH: "true",
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-location-id",
    GHL_BASE_URL: "https://services.leadconnectorhq.com",
    ...overrides,
  };
}

function makeOperation() {
  return {
    entity: "outboundMessage",
    action: "dispatch",
    locationId: "test-location-id",
    externalId: null,
    payload: {
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      outboundMessageId: "message-1",
      content: "Hello from Venue OS",
    },
  } as const;
}

function createLoggerCapture() {
  const entries: Array<{
    level: "info" | "warn";
    message: string;
    metadata: unknown;
  }> = [];

  const logger: GhlExecutionLogger = {
    info(message, metadata) {
      entries.push({
        level: "info",
        message,
        metadata,
      });
    },
    warn(message, metadata) {
      entries.push({
        level: "warn",
        message,
        metadata,
      });
    },
  };

  return {
    logger,
    entries,
  };
}

describe("executeGhlWrite", () => {
  it("blocks writes when execution mode is disabled", async () => {
    const { logger, entries } = createLoggerCapture();
    let liveCalls = 0;

    const result = await executeGhlWrite({
      operation: makeOperation(),
      observability: OBSERVABILITY,
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      outboundMessageId: "message-1",
      env: makeEnv({
        GHL_EXECUTION_MODE: "disabled",
        GHL_WRITE_KILL_SWITCH: "false",
      }),
      logger,
      now: new Date("2026-04-12T15:00:00.000Z"),
      executeLive: async () => {
        liveCalls += 1;
        return { ok: true };
      },
    });

    assert.equal(result.decision, "blocked");
    assert.equal(result.reason, "mode_disabled");
    assert.equal(liveCalls, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.level, "warn");
    assert.equal(
      (entries[0]?.metadata as { eventType: string }).eventType,
      "ghl.write_blocked"
    );
  });

  it("emits a structured shadow log in dry-run mode without executing the live callback", async () => {
    const { logger, entries } = createLoggerCapture();
    let liveCalls = 0;

    const operation = makeOperation();
    const result = await executeGhlWrite({
      operation,
      observability: OBSERVABILITY,
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      outboundMessageId: "message-1",
      env: makeEnv({
        GHL_EXECUTION_MODE: "dry_run",
        GHL_WRITE_KILL_SWITCH: "true",
      }),
      logger,
      now: new Date("2026-04-12T15:05:00.000Z"),
      executeLive: async () => {
        liveCalls += 1;
        return { ok: true };
      },
    });

    assert.equal(result.decision, "dry_run");
    assert.equal(liveCalls, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.level, "info");
    assert.equal(
      (entries[0]?.metadata as { eventType: string }).eventType,
      "ghl.write_dry_run"
    );
    assert.deepEqual(
      (entries[0]?.metadata as { operation: typeof operation }).operation.payload,
      operation.payload
    );
  });

  it("blocks live writes when the hard kill switch is enabled", async () => {
    const { logger, entries } = createLoggerCapture();
    let liveCalls = 0;

    const result = await executeGhlWrite({
      operation: makeOperation(),
      observability: OBSERVABILITY,
      tenantId: "tenant-1",
      env: makeEnv({
        GHL_EXECUTION_MODE: "live",
        GHL_WRITE_KILL_SWITCH: "true",
      }),
      logger,
      now: new Date("2026-04-12T15:10:00.000Z"),
      executeLive: async () => {
        liveCalls += 1;
        return { ok: true };
      },
    });

    assert.equal(result.decision, "blocked");
    assert.equal(result.reason, "kill_switch_enabled");
    assert.equal(liveCalls, 0);
    assert.equal(entries.length, 1);
    assert.equal(
      (entries[0]?.metadata as { reason: string }).reason,
      "kill_switch_enabled"
    );
  });

  it("fails fast with a clear error when live mode is missing required GHL env", async () => {
    await assert.rejects(
      executeGhlWrite({
        operation: makeOperation(),
        observability: OBSERVABILITY,
        tenantId: "tenant-1",
        env: makeEnv({
          GHL_EXECUTION_MODE: "live",
          GHL_WRITE_KILL_SWITCH: "false",
          GHL_API_KEY: "",
        }),
        now: new Date("2026-04-12T15:15:00.000Z"),
        executeLive: async () => ({ ok: true }),
      }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message.includes("Live GHL writes require valid environment variables") &&
        error.message.includes("GHL_API_KEY")
    );
  });

  it("executes the live callback only after env validation and a released kill switch", async () => {
    const { logger, entries } = createLoggerCapture();
    let liveCalls = 0;

    const result = await executeGhlWrite({
      operation: makeOperation(),
      observability: OBSERVABILITY,
      tenantId: "tenant-1",
      env: makeEnv({
        GHL_EXECUTION_MODE: "live",
        GHL_WRITE_KILL_SWITCH: "false",
      }),
      logger,
      now: new Date("2026-04-12T15:20:00.000Z"),
      executeLive: async (liveEnv) => {
        liveCalls += 1;
        return {
          baseUrl: liveEnv.GHL_BASE_URL,
        };
      },
    });

    assert.equal(result.decision, "live");
    assert.equal(liveCalls, 1);
    assert.equal(result.liveEnv.GHL_LOCATION_ID, "test-location-id");
    assert.equal(result.result.baseUrl, "https://services.leadconnectorhq.com");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.level, "info");
    assert.equal(
      (entries[0]?.metadata as { eventType: string }).eventType,
      "ghl.write_live"
    );
  });
});
