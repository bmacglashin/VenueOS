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
- Shift 10 - Mission Control v0 (complete)
<<<<<<< codex/add-tenant-seeder-script
- Shift 11 - tenant seeder (complete)

## Current branch
- `chore/shift-11-tenant-seeder`

## Files changed this shift
- `src/lib/config/admin-env.ts`
- `src/lib/db/admin.ts`
- `scripts/seed-tenant.ts`
- `package.json`
- `docs/MASTER_PLAN.md`
- `docs/BUILD_STATE.md`

## Validation run
- `npm run seed:tenant -- --help` (passes; argument parsing/help output verified)
- `npx tsc --noEmit` (fails in this environment: dependency/type-resolution issues in existing setup)
- `npm run lint` (passes)

## Blockers / open questions
- Seeding against a live Supabase project was not executed in this environment because no verified runtime credentials were provided for a safe write test.

## Env readiness
- Shift 11 adds a manual operations script at `scripts/seed-tenant.ts` to seed one tenant at a time with required `name` and `slug` arguments and optional `--ghl-location-id` (`mock` maps to `null`).
- Duplicate slug inserts are prevented by an explicit pre-check before insert, plus the existing database unique index on `venue_tenants.slug`.
- Admin Supabase env parsing is now isolated in `src/lib/config/admin-env.ts` so server-side admin use-cases only require `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- A new package script `seed:tenant` runs TypeScript directly with Node 22 (`--experimental-strip-types`), avoiding extra script-runner dependencies.
=======
- Shift 12 - QA golden dataset (complete)

## Current branch
- `test/shift-12-golden-dataset`

## Files changed this shift
- `evals/venue-golden-dataset.json`
- `docs/BUILD_STATE.md`

## Validation run
- `python -m json.tool evals/venue-golden-dataset.json` (passes)
- `node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync('evals/venue-golden-dataset.json','utf8')); const categories=[...new Set(data.cases.map((c)=>c.expectedRoute))]; const required=['general_hospitality','high_ticket_event','booking_request','unknown_needs_review']; const missing=required.filter((value)=>!categories.includes(value)); if(missing.length>0){console.error('Missing route coverage:', missing.join(', ')); process.exit(1);} console.log('Route coverage OK:', categories.join(', '));"` (passes)

## Blockers / open questions
- No git remote is configured in this environment, so `git fetch/pull` from `origin` and `git push origin test/shift-12-golden-dataset` cannot run here.

## Env readiness
- Added a reusable golden dataset file for Shift 12 under `evals/` with stable case schema and scenario-level routing + answer-shape expectations.
- Scenarios prioritize grounded behavior and escalation for unknown or high-risk policy details not present in current venue knowledge.
>>>>>>> main

## Next recommended shift
- Shift 12 - QA golden dataset
