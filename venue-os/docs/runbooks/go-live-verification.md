# Go-Live Verification

This runbook covers the outbound kill switch, pre-launch readiness, launch-day checks, and the minimum verification needed before outbound is re-enabled.

## Outbound modes

- `enabled`: auto-send is allowed only when the 12A.1 response policy returns `safe_to_send`.
- `review_only`: outbound transport is withheld and otherwise-safe replies are queued for operator review.
- `disabled`: outbound transport is blocked for every candidate and the block reason is recorded in audit metadata.

Precedence:

- Global `disabled` beats every tenant override.
- Global `review_only` beats every tenant override.
- Tenant override applies only when global mode is `enabled`.

## Pre-launch checks

1. Confirm the deploy has `OUTBOUND_MODE=review_only` before any live traffic reaches the app.
2. Set `OPS_STATUS_TOKEN` for the environment that will expose `/api/ops/status`.
3. Run `npm test` and confirm the outbound precedence, idempotency, and endpoint tests pass.
4. Apply the latest Supabase migrations, including `0005_webhook_idempotency_ops.sql`.
5. Verify `GET /api/health` returns `200` with `"ready": true`.
6. Verify `GET /api/ops/status` returns `200` when called with the shared token.
7. Verify Mission Control loads and shows the expected outbound mode banner for the target tenant.
8. Spot-check at least one recent conversation and confirm the draft panel shows a policy decision plus an outbound action badge.
9. Confirm any tenant-specific override values in `venue_tenants.outbound_mode_override` are intentional and documented for launch day.

## Launch-day checks

1. Keep the global mode at `review_only` while the first live inbound turns are observed.
2. Confirm `GET /api/health` stays green while traffic is flowing.
3. Poll `GET /api/ops/status` and confirm `inboundReceived` is increasing with live traffic.
4. Confirm `duplicateDropped` only increases when the provider retries the same delivery.
5. Confirm new safe candidates appear in Mission Control as `Queue` rather than `Proceed`.
6. Check audit logs for `review.queued`, `outbound.blocked`, `outbound.sent`, and `idempotency.dropped` events as traffic moves through the system.
7. Validate that no unexpected outbound transport attempts appear while the system remains in `review_only`.
8. Reconfirm tenant overrides for any pilot tenants before switching global mode to `enabled`.

## Endpoint usage

Health:

```bash
curl -sS "$APP_URL/api/health"
```

Ops counters:

```bash
curl -sS \
  -H "Authorization: Bearer $OPS_STATUS_TOKEN" \
  "$APP_URL/api/ops/status"
```

Expected fields:

- `live`, `ready`, and `status` on `/api/health`
- `counters.inboundReceived`
- `counters.reviewQueued`
- `counters.outboundSent`
- `counters.outboundBlocked`
- `counters.outboundFailed`
- `counters.duplicateDropped`
- `lastAuditLogAt`

## Kill-switch usage

Global kill switch:

- Set `OUTBOUND_MODE=disabled`.
- Redeploy or restart the environment so the new config value is active.
- Confirm Mission Control shows the `disabled` banner before assuming outbound is stopped.

Tenant-only hold:

- Set `venue_tenants.outbound_mode_override` to `disabled` or `review_only` for the affected tenant.
- Keep global mode at `enabled` if the hold should stay tenant-specific.
- Refresh Mission Control for that tenant and confirm the badge reflects the resolved mode.

## Before re-enabling outbound

1. Identify and document the reason outbound was disabled or held in review.
2. Confirm the triggering issue is resolved and no active incident remains.
3. Review recent blocked or queued conversations in Mission Control and verify there are no unresolved policy anomalies.
4. Confirm audit logs show the expected resolved mode and delivery action after the fix.
5. Re-enable in two steps when possible: `disabled` -> `review_only` first, then `review_only` -> `enabled` after validating live behavior.
6. After re-enabling, watch the first safe candidate and verify it resolves to `Proceed` only when the policy remains `safe_to_send`.
