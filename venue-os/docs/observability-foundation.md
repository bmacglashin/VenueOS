# Observability Foundation

Shift 12D.1 standardizes how Venue OS names operational events, correlates request flow, and classifies non-policy failures.

## Request correlation

- Every inbound webhook request resolves a `requestId` and `traceId`.
- The API reuses `x-request-id`, `x-trace-id`, or the W3C `traceparent` trace ID when present.
- When those headers are missing, Venue OS generates new IDs at intake and reuses them across routing, policy evaluation, drafting, and outbound transport.
- API responses echo the IDs in both response headers and JSON payloads.

## Structured event names

Audit log rows now use a consistent dotted event vocabulary:

- `inbound.received`
- `idempotency.dropped`
- `route.classified`
- `policy.evaluated`
- `response.drafted`
- `review.queued`
- `outbound.blocked`
- `outbound.sent`
- `outbound.failed`
- `orchestration.halted`

Each audit row persists:

- `event_type`
- `request_id`
- `trace_id`
- `error_type`
- event payload details for the stage

## Operational error taxonomy

Operational errors are intentionally separate from business-policy reasons such as `pricing_unverified` or `low_confidence_route`.

- `validation_error`: malformed request data, missing required input, or schema validation failures
- `config_error`: invalid or missing runtime configuration
- `db_error`: database or persistence failures
- `external_api_error`: upstream model/provider failures
- `timeout_error`: timeout or abort conditions
- `idempotency_drop`: duplicate inbound messages that were intentionally dropped
- `unknown_error`: anything not classified more specifically

## Storage and visibility

- Audit logs persist the correlation IDs and error taxonomy in dedicated columns.
- Processed webhook delivery keys persist in `processed_webhook_events` with a uniqueness guarantee on `(source, idempotency_key)`.
- Mission Control surfaces request IDs, trace IDs, and error types directly in the audit log panel.
- Message metadata for inbound and drafted outbound records also includes the observability context for turn-level inspection.
- `/api/health` exposes lightweight readiness checks, and `/api/ops/status` reads launch counters from the shared audit trail.
