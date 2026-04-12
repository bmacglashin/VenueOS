# GHL Launch Checklist

Use this checklist for Monday launch prep around the 12H.2 GHL execution guards.

`GHL_EXECUTION_MODE` and `GHL_WRITE_KILL_SWITCH` are the launch controls from 12H.2. In the current build, a `ghl.write_live` log proves the guard opened, but the provider write path still reports `pending_live_wiring` until Shift 13.

## References

- [GHL env checklist](./ghl-env-checklist.md)
- [GHL rollback checklist](./ghl-rollback-checklist.md)
- [GHL kill-switch checklist](./ghl-kill-switch-checklist.md)
- [GHL known failures](./ghl-known-failures.md)
- [Go-live verification](../runbooks/go-live-verification.md)

## Before the launch window

1. Confirm `GET /api/health` returns `200` with `"ready": true`.
2. Confirm the health payload lists no missing or invalid GHL variables.
3. Confirm `GET /api/ops/status` works with `OPS_STATUS_TOKEN`.
4. Confirm `OUTBOUND_MODE=review_only` before touching any GHL flags.
5. Confirm `GHL_EXECUTION_MODE=dry_run`.
6. Confirm `GHL_WRITE_KILL_SWITCH=true`.
7. Confirm `GHL_API_KEY`, `GHL_LOCATION_ID`, and `GHL_BASE_URL` match the intended GHL sub-account.
8. Capture a baseline for `inboundReceived`, `outboundSent`, `outboundFailed`, `duplicateDropped`, and `lastAuditLogAt`.
9. Freeze manual GHL field and sub-account changes for the launch window.

## Launch steps

1. Keep one operator in Mission Control and one engineer on structured logs.
2. Set `GHL_EXECUTION_MODE=live`.
3. Set `GHL_WRITE_KILL_SWITCH=false`.
4. Redeploy or restart the environment so both values are active.
5. Recheck `GET /api/health`.
6. Stop immediately if health returns `503` or reports missing or invalid GHL variables.
7. Send one safe canary inbound message through the shared webhook path.
8. Confirm the canary produces `inbound.received` in the audit trail.
9. Confirm the conversation appears in Mission Control.
10. Confirm structured logs contain `ghl.write_live` for the canary path. In the current build, that proves the 12H.2 guard opened, not that Shift 13 vendor delivery is complete.
11. Confirm `GET /api/ops/status` shows `inboundReceived` increasing and no surprise jump in `outboundFailed`.
12. Keep `OUTBOUND_MODE=review_only` until the launch lead approves any broader outbound change.

## Stop and roll back immediately if

1. `/api/health` goes degraded.
2. The canary produces `outbound.failed` or `orchestration.halted`.
3. The payload resolves to the wrong tenant or wrong GHL sub-account.
4. `duplicateDropped` spikes beyond expected provider retries.
5. Structured logs show wrong field values, wrong location IDs, or unexpected blocked writes.

If any stop condition hits, run the [kill-switch checklist](./ghl-kill-switch-checklist.md) first and then the [rollback checklist](./ghl-rollback-checklist.md).

## Quick checks

Health:

```bash
curl -sS "$APP_URL/api/health"
```

Ops status:

```bash
curl -sS \
  -H "Authorization: Bearer $OPS_STATUS_TOKEN" \
  "$APP_URL/api/ops/status"
```
