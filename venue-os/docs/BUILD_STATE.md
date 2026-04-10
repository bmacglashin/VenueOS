# Build State

## Completed shifts
- Shift 1 - repo source of truth (complete)
- Shift 2 - dependencies + config (complete)
- Shift 3 - AI service (complete)
- Shift 4 - knowledge loading + caching (complete)
- Shift 5 - structured routing (complete)
- Shift 6 - Supabase schema (complete)
- Shift 7 - Supabase clients + services (complete)
- Shift 8 - memory MVP (complete)
- Shift 9 - internal webhook loop (complete)

## Current branch
- `feat/shift-09-internal-webhook-loop`

## Files changed this shift
- `app/api/ghl-webhook/route.ts`
- `src/app/api/ghl-webhook/route.ts`
- `src/services/conversations.ts`
- `docs/BUILD_STATE.md`
- `docs/MASTER_PLAN.md`

## Validation run
- `npx tsc --noEmit` (passes)
- `npm run lint` (passes)
- `npm run build` with placeholder non-Supabase env values for missing local runtime vars (passes)
- Local webhook probe to `POST /api/ghl-webhook` with valid JSON but no `locationId` returns `200 OK` and `accepted: false` for unresolved tenant
- Local webhook probe to `POST /api/ghl-webhook` with invalid JSON returns `200 OK` and `accepted: false`
- Local webhook probe to `POST /api/ghl-webhook` with a `locationId` returns `200 OK` and `accepted: false` when tenant lookup hits the current Supabase schema blocker
- `git diff --check` (passes, line-ending warnings only)

## Blockers / open questions
- The connected Supabase environment exposed by the local `.env.local` only provides Supabase credentials, and the target project currently reports `public.venue_tenants` missing from the schema cache. That prevented confirming end-to-end DB writes for a tenant-resolved webhook hit in this environment.

## Env readiness
- The GHL webhook route now reads the raw request body, safely parses JSON, preserves the parsed payload plus raw body for debugging, and extracts `locationId`, `contactId`, `conversationId`, `messageId`, `receivedAt`, and inbound message text with a narrow best-effort field map.
- Tenant resolution now uses `venue_tenants.ghl_location_id` through the shared conversation service instead of route-local Supabase queries.
- The internal webhook loop now creates or finds the conversation through shared services, hands the normalized turn to the Shift 8 memory-aware orchestrator, and relies on that orchestration layer to persist the inbound message plus AI draft without sending anything outbound.
- Non-happy-path webhook hits now stay internal-loop safe: invalid JSON, unresolved tenants, missing message bodies, and pre-orchestration failures all return `200 OK` and capture raw-payload debugging context through logs or tenant-scoped audit entries when possible.
- Added a top-level `app/api/ghl-webhook/route.ts` shim that re-exports the requested `src/app/...` handler so Next.js serves the webhook under the repository's active `app` directory.

## Next recommended shift
- Shift 10 - Mission Control v0
