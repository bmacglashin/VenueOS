# GHL Kill-Switch Checklist

Use this when the safest move is to stop all GHL writes immediately.

This is the fastest response for wrong-account risk, duplicate creation, field drift, auth failure, vendor outage, or any unknown GHL issue.

## Trigger conditions

1. Wrong `GHL_LOCATION_ID`, wrong sub-account, or wrong base URL.
2. Duplicate lead or contact creation.
3. Vendor auth, rate-limit, or outage signals.
4. Unexpected `outbound.failed` or `orchestration.halted`.
5. Structured logs show wrong field payloads or wrong destination context.

## Kill-switch steps

1. Set `GHL_WRITE_KILL_SWITCH=true`.
2. Redeploy or restart the environment.
3. Keep `OUTBOUND_MODE=review_only` if customer-facing outbound also needs to stay held.
4. If the environment looks unstable or misconfigured, also set `GHL_EXECUTION_MODE=dry_run`.
5. Post the incident time, operator name, and trigger reason in the launch thread.

## Verify the hold

1. Send one safe canary.
2. Confirm no new `ghl.write_live` log appears after the kill-switch timestamp.
3. Confirm the canary produces `ghl.write_blocked` with `reason=kill_switch_enabled`, or `ghl.write_dry_run` if the mode was also changed.
4. Confirm Mission Control still shows held or queued behavior instead of a new live transport attempt.
5. Watch `GET /api/ops/status`; `inboundReceived` may continue, but the trigger condition should stop spreading.

## Clear only when

1. Root cause is known.
2. `GHL_API_KEY`, `GHL_LOCATION_ID`, and `GHL_BASE_URL` have been revalidated.
3. Engineering and the launch lead approve re-entry.
4. A canary passes in `dry_run` before returning to `live`.
