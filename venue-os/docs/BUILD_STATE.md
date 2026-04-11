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
- Shift 11 - tenant seeder (complete)
- Shift 12 - QA golden dataset (complete)
- Shift 12B.1 - eval runner and baseline capture (complete)
- Shift 12B.2 - route scoring and red-team eval coverage (complete)
- Shift 12E.1 - knowledge ingestion metadata and onboarding SOP (complete)
- Shift 12E.2 - second tenant seed and tenant-isolation pressure test (complete)

## Current branch
- `feat/shift-12e-second-tenant-isolation`

## Files changed this shift
- `src/data/harborview-loft-knowledge.md`
- `src/data/mock-tenants.ts`
- `src/lib/llm/knowledge.ts`
- `src/lib/llm/knowledge.test.ts`
- `src/services/conversations.ts`
- `src/services/messages.ts`
- `src/services/mission-control.ts`
- `src/services/mission-control.test.ts`
- `src/services/review-queue.ts`
- `src/services/review-queue.test.ts`
- `src/services/operator-review.ts`
- `src/services/operator-review.test.ts`
- `src/services/conversation-orchestrator.ts`
- `src/app/mission-control/conversations/[id]/page.tsx`
- `src/app/mission-control/conversations/[id]/actions.ts`
- `src/app/mission-control/sandbox/page.tsx`
- `src/components/mission-control/conversation-list.tsx`
- `src/components/mission-control/draft-review-panel.tsx`
- `src/components/mission-control/review-queue-table.tsx`
- `scripts/seed-mock-tenants.ts`
- `docs/runbooks/second-tenant-validation-checklist.md`
- `docs/knowledge-onboarding.md`
- `package.json`
- `README.md`
- `docs/BUILD_STATE.md`

## Validation run
- `npm test`
- `npm run lint`

## Blockers / open questions
- No blockers. Mission Control tenant filters now preserve tenant scope into conversation detail and sandbox flows.

## Env readiness
- `npm run seed:mock-tenants` creates two usable local/dev tenants with seeded knowledge and reviewable sample records.
- Runtime knowledge loading now resolves the registered pack per tenant slug instead of reusing a single global file.
- Mission Control conversation detail, sandbox selection, and operator actions reject cross-tenant lookups when tenant scope is present.
- Review queue filters no longer leak cross-tenant counts, options, or rows when a tenant filter is active.
- Added unit pressure tests covering tenant-specific knowledge loading, Mission Control conversation isolation, review queue visibility, and operator action scoping.

## Next recommended shift
- Shift 12E.3 - tenant-aware webhook and seeded tenant smoke path hardening
