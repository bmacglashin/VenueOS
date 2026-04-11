import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyObservabilityHeaders,
  classifyOperationalError,
  ConfigError,
  createObservabilityContextFromHeaders,
  DatabaseError,
  ExternalApiError,
  IdempotencyDropError,
  TimeoutError,
  ValidationError,
} from "./observability";

describe("createObservabilityContextFromHeaders", () => {
  it("reuses inbound request and trace IDs when present", () => {
    const headers = new Headers({
      "x-request-id": "req_live_123",
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });

    const context = createObservabilityContextFromHeaders(headers);

    assert.deepEqual(context, {
      requestId: "req_live_123",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
  });

  it("writes the observability IDs back to response headers", () => {
    const headers = applyObservabilityHeaders(new Headers(), {
      requestId: "req_live_456",
      traceId: "trace_live_789",
    });

    assert.equal(headers.get("x-request-id"), "req_live_456");
    assert.equal(headers.get("x-trace-id"), "trace_live_789");
  });
});

describe("classifyOperationalError", () => {
  it("maps explicit operational error classes into the published taxonomy", () => {
    assert.equal(
      classifyOperationalError(new ValidationError("invalid payload")),
      "validation_error"
    );
    assert.equal(
      classifyOperationalError(new ConfigError("missing env")),
      "config_error"
    );
    assert.equal(
      classifyOperationalError(new DatabaseError("query failed")),
      "db_error"
    );
    assert.equal(
      classifyOperationalError(new ExternalApiError("provider failed")),
      "external_api_error"
    );
    assert.equal(
      classifyOperationalError(new TimeoutError("request timed out")),
      "timeout_error"
    );
    assert.equal(
      classifyOperationalError(new IdempotencyDropError("duplicate inbound")),
      "idempotency_drop"
    );
  });

  it("recognizes duplicate inbound message violations as idempotency drops", () => {
    const duplicateError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "messages_ghl_message_id_key"',
    };

    assert.equal(classifyOperationalError(duplicateError), "idempotency_drop");
  });

  it("falls back to unknown_error when nothing stronger matches", () => {
    assert.equal(
      classifyOperationalError(new Error("unexpected boom")),
      "unknown_error"
    );
  });
});
