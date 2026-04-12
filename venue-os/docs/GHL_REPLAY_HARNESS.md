# GHL Replay Harness

Shift 12H.3 adds a deterministic replay harness for mock GoHighLevel payloads. The harness drives the shared internal webhook handler path used in production, keeps live writes disabled, and prints a pass/fail summary for every replayed fixture.

## Command

Run the full fixture library from the `venue-os/` app directory:

```bash
npm run ghl:replay -- --run-id local-docs-run
```

List the available fixtures:

```bash
npm run ghl:replay -- --list
```

Replay a single fixture:

```bash
npm run ghl:replay -- --run-id note-only --fixture note-hours-safe
```

## What it replays

The shipped fixture library covers:

- contact events
- opportunity events
- note events
- outbound-message events
- a duplicate outbound-message replay that proves idempotency drops stay on the real handler path

Each fixture enters `createWebhookPostHandler()` with the same request/response contract as the production webhook route. The harness then uses deterministic in-memory dependencies for tenant lookup, idempotency state, and message persistence so the run stays local and debuggable.

## Safety defaults

- `GHL_EXECUTION_MODE` is forced to `dry_run` during replay.
- `GHL_WRITE_KILL_SWITCH` is forced to `true` during replay.
- Live writes are not enabled by this harness.
- Successful safe-to-send fixtures still pass through the shared outbound transport guard, which resolves as `dry_run`.

## Logging and debugging

The replay CLI emits structured JSON log lines during the run and then prints a readable summary. Each replay gets:

- a replay-scoped `requestId`
- a replay-scoped `traceId`
- the fixture event ID as the webhook idempotency key source

Failures include exact expected-vs-actual checks for:

- response acceptance / duplicate / error type
- returned conversation and message IDs
- routed category
- policy decision
- outbound action / transport outcome
- audit event sequence

## Sample output

```text
Replay run local-docs-run: 5/5 passed, 0 failed
PASS contact-pricing-review [contact] accepted=true duplicate=false route=general_hospitality policy=needs_review outbound=queue transport=none trace=local-docs-run:01:contact-pricing-review:trace
PASS opportunity-buyout-review [opportunity] accepted=true duplicate=false route=high_ticket_event policy=needs_review outbound=queue transport=none trace=local-docs-run:02:opportunity-buyout-review:trace
PASS note-hours-safe [note] accepted=true duplicate=false route=general_hospitality policy=safe_to_send outbound=proceed transport=dry_run trace=local-docs-run:03:note-hours-safe:trace
PASS outbound-message-safe [outboundMessage] accepted=true duplicate=false route=booking_request policy=safe_to_send outbound=proceed transport=dry_run trace=local-docs-run:04:outbound-message-safe:trace
PASS outbound-message-duplicate-drop [outboundMessage] accepted=true duplicate=true route=none policy=none outbound=none transport=none trace=local-docs-run:05:outbound-message-duplicate-drop:trace
```
