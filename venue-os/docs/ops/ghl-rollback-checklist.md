# GHL Rollback Checklist

Use this checklist when Monday launch prep must be backed out cleanly.

This rollback is centered on the 12H.2 GHL controls: `GHL_EXECUTION_MODE` and `GHL_WRITE_KILL_SWITCH`.

## Immediate rollback

1. Set `GHL_WRITE_KILL_SWITCH=true`.
2. Keep `OUTBOUND_MODE=review_only` while the incident is active.
3. Redeploy or restart immediately.
4. If the issue is not clearly transient, set `GHL_EXECUTION_MODE=dry_run`.
5. If the environment should stop participating entirely, set `GHL_EXECUTION_MODE=disabled`.
6. Announce the rollback timestamp and freeze further GHL config edits until verification is complete.

## Verify the rollback held

1. Confirm `GET /api/health` no longer shows unexpected GHL config drift.
2. Send one safe canary through the same path that triggered the rollback.
3. Confirm no new `ghl.write_live` log appears after the rollback timestamp.
4. Confirm the canary now produces either:
   - `ghl.write_blocked` with `reason=kill_switch_enabled`, or
   - `ghl.write_dry_run` if `GHL_EXECUTION_MODE=dry_run`
5. Confirm `outbound.failed` and `orchestration.halted` stop increasing for the incident.
6. Record the request IDs, trace IDs, tenant, and env values used during rollback.

## Before retrying launch

1. Classify the incident with the [known failures playbook](./ghl-known-failures.md).
2. Re-verify `GHL_API_KEY`, `GHL_LOCATION_ID`, and `GHL_BASE_URL`.
3. Do not clear the kill switch until engineering and the launch lead approve a second attempt.
4. Re-enter in two steps when possible: `dry_run` validation first, then `live` with `GHL_WRITE_KILL_SWITCH=false`.
