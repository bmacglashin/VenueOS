# GHL Env Checklist

Use this checklist before allowing any live GoHighLevel writes.

## Required variables

- `GHL_EXECUTION_MODE`
  Allowed values: `disabled`, `dry_run`, `live`
  Safe default: `dry_run`
- `GHL_WRITE_KILL_SWITCH`
  Allowed values: `true`, `false`, `1`, `0`, `on`, `off`, `enabled`, `disabled`
  Safe default: `true`
- `GHL_API_KEY`
  Must be a non-empty private API credential for the target GHL account
- `GHL_LOCATION_ID`
  Must be the non-empty location identifier for the target tenant/workspace
- `GHL_BASE_URL`
  Must be a valid HTTPS base URL such as `https://services.leadconnectorhq.com`

## Launch-ready state

1. Set `GHL_EXECUTION_MODE=dry_run`.
2. Keep `GHL_WRITE_KILL_SWITCH=true`.
3. Confirm `/api/health` reports no missing or invalid required GHL variables.
4. Trigger a safe test turn and confirm the app emits a `ghl.write_dry_run` structured log with the exact shadow payload.
5. Before live rollout, verify the real `GHL_API_KEY`, `GHL_LOCATION_ID`, and `GHL_BASE_URL` are present in the target environment.

## Enable live writes

1. Leave `OUTBOUND_MODE=review_only` until the live GHL environment is verified.
2. Set `GHL_EXECUTION_MODE=live`.
3. Release the hard kill switch by setting `GHL_WRITE_KILL_SWITCH=false`.
4. Watch the next safe candidate and confirm a `ghl.write_live` structured log appears.

## Rollback

1. Flip `GHL_WRITE_KILL_SWITCH=true`.
2. Redeploy or restart the environment so the new value is active.
3. If a broader hold is needed, also move `GHL_EXECUTION_MODE` back to `dry_run` or `disabled`.
