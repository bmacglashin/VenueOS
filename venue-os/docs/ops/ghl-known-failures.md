# GHL Known Failures

Use this playbook when GHL launch prep degrades.

For any issue that could create bad writes, run the [kill-switch checklist](./ghl-kill-switch-checklist.md) before diagnosis. Capture the `requestId`, `traceId`, tenant, `OUTBOUND_MODE`, `GHL_EXECUTION_MODE`, `GHL_WRITE_KILL_SWITCH`, `GHL_LOCATION_ID`, and `GHL_BASE_URL` for the incident record.

The current build is still pre-Shift 13 live wiring. `ghl.write_live` proves the 12H.2 guard opened, but the provider write path remains `pending_live_wiring`. Some detection steps below therefore rely on config health, replay output, Mission Control, or vendor-side signals rather than a fully live send result.

## Auth failure

### Detection

- `GET /api/health` reports missing or invalid GHL variables.
- Vendor-side checks show `401` or `403` once live wiring is enabled.
- Audit logs show `outbound.failed` or `orchestration.halted` with `config_error` or `external_api_error`.

### Immediate action

1. Enable the kill switch.
2. Verify `GHL_API_KEY`, `GHL_BASE_URL`, and `GHL_LOCATION_ID` against the approved launch values.
3. Re-run only a `dry_run` canary until the credential mismatch is resolved.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true`.
2. Move `GHL_EXECUTION_MODE` back to `dry_run`.
3. Use `disabled` if the environment should stop handling GHL traffic entirely.

### Escalation

- Escalate immediately to the launch lead, engineering owner, and GHL admin.
- Add vendor support if the key appears revoked, expired, or incorrectly scoped.

## Webhook signature failure

### Detection

- The current app handler does not emit a dedicated signature error, so detection is mainly at the vendor or ingress layer.
- GHL delivery logs show signature or authorization failure before the app accepts the webhook.
- `inboundReceived` stays flat even though GHL shows attempted deliveries.
- No matching `inbound.received` audit row appears for the expected request window.

### Immediate action

1. Do not keep flipping 12H.2 flags; this is usually an ingress mismatch.
2. Verify the webhook secret and header expectations in the edge or proxy layer.
3. Use a captured sample or the replay harness to confirm the app path still parses once the request reaches the handler.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true` or move back to `dry_run` while ingress is being fixed.
2. Do not reopen `live` until a canary webhook is accepted end to end.

### Escalation

- Escalate to the engineering owner and whoever owns ingress, proxy, or deployment configuration.
- Add the GHL admin if the signature or delivery settings were edited in the vendor console.

## Field mapping drift

### Detection

- `ghl.write_dry_run` or `ghl.write_live` payloads show missing, renamed, or wrong custom field IDs.
- Replay output no longer matches expected payload shape for the canary fixture.
- Vendor-side validation returns `400` or `422` once live wiring is enabled.

### Immediate action

1. Enable the kill switch.
2. Freeze manual GHL field edits.
3. Compare the current GHL field IDs with the expected mapping before retrying.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true`.
2. Return to `GHL_EXECUTION_MODE=dry_run`.
3. Re-run the canary only after the mapping diff is understood and corrected.

### Escalation

- Escalate to the engineering owner and GHL admin.
- Include the exact field names and IDs that changed.

## Duplicate lead creation

### Detection

- Operators see two GHL records for one request or trace ID.
- Duplicate creation continues even though normal webhook retries are already being dropped as `idempotency.dropped`.
- A single canary appears more than once in the target GHL workspace.

### Immediate action

1. Enable the kill switch.
2. Stop manual retries or resend attempts.
3. Capture the duplicated request IDs, contact identifiers, and timestamps.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true`.
2. Move back to `GHL_EXECUTION_MODE=dry_run`.
3. Quarantine or merge duplicate records in GHL before reopening the path.

### Escalation

- Escalate immediately to the launch lead, engineering owner, and GHL admin.
- If customer operations might act on the duplicates, notify the operator lead at once.

## Partial write or timeout

### Detection

- Audit logs show `outbound.failed` or `orchestration.halted` with `timeout_error`.
- Vendor-side state is ambiguous, with a record partially created or missing confirmation.
- The same canary is retried because the first attempt did not resolve cleanly.

### Immediate action

1. Enable the kill switch.
2. Stop retries until the write outcome is known.
3. Inspect vendor-side state for the exact request or contact before replaying anything.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true`.
2. Move back to `GHL_EXECUTION_MODE=dry_run`.
3. Reconcile any partial vendor-side record before re-entry.

### Escalation

- Escalate to the engineering owner within five minutes.
- Add the GHL admin if manual cleanup is required in the target workspace.

## Rate limit or vendor outage

### Detection

- Multiple canaries or live attempts fail with `429`, `5xx`, `external_api_error`, or `timeout_error`.
- `outbound.failed` rises quickly while app health remains otherwise green.
- Vendor status or support channels report an active incident.

### Immediate action

1. Enable the kill switch.
2. Keep `OUTBOUND_MODE=review_only`.
3. Stop retry storms and capture the first failure timestamp.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true`.
2. Return to `GHL_EXECUTION_MODE=dry_run`.
3. Retry only after vendor health is confirmed stable.

### Escalation

- Escalate immediately to the launch lead and engineering owner.
- Open or attach a vendor support ticket with timestamps and affected request IDs.

## Outbound message rejection

### Detection

- Vendor-side validation rejects the payload, recipient, or content.
- Audit logs show `outbound.failed` for otherwise valid conversation flow.
- Mission Control shows the draft exists, but the transport step is not accepted downstream.

### Immediate action

1. If the rejection looks systemic, enable the kill switch.
2. Inspect the recipient, content, and destination context for the failed draft.
3. Confirm the canary is using the intended tenant and outbound policy path.

### Rollback

1. Keep or return to `GHL_EXECUTION_MODE=dry_run` for systemic rejection.
2. Hold customer-facing outbound in `review_only` until the payload issue is corrected.
3. Retry only with a fresh canary after the content or recipient data is fixed.

### Escalation

- Escalate to the engineering owner.
- Add the operator lead if the rejection suggests compliance, content, or recipient-quality issues.

## Stale env or wrong sub-account configuration

### Detection

- `GHL_LOCATION_ID`, `GHL_BASE_URL`, or the active API key do not match the approved launch sheet.
- A canary resolves to the wrong tenant, wrong location, or wrong GHL workspace.
- Webhooks return tenant lookup failures such as unresolved location context.

### Immediate action

1. Enable the kill switch.
2. Freeze deploys and manual GHL edits.
3. Compare deployed env values with the approved launch values before touching `live` again.

### Rollback

1. Keep `GHL_WRITE_KILL_SWITCH=true`.
2. Move back to `GHL_EXECUTION_MODE=dry_run` or `disabled`.
3. Redeploy the last known-good env set before re-entry.

### Escalation

- Escalate immediately to the launch lead, engineering owner, environment owner, and GHL admin.
- Treat wrong-sub-account risk as a stop-the-line incident.
