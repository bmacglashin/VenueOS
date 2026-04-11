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

## Current branch
- `feat/shift-12e-knowledge-metadata-onboarding`

## Files changed this shift
- `supabase/migrations/0006_knowledge_source_metadata.sql`
- `src/lib/db/supabase.ts`
- `src/lib/llm/knowledge.ts`
- `src/services/knowledge-ingestion.ts`
- `src/services/knowledge-ingestion.test.ts`
- `docs/knowledge-onboarding.md`
- `docs/BUILD_STATE.md`
- `package.json`

## Validation run
- `npm test`
- `npm run lint`

## Blockers / open questions
- No blockers. Metadata sync intentionally degrades gracefully when no tenant matches `GHL_LOCATION_ID` so request handling is not interrupted.

## Env readiness
- Knowledge ingestion now records tenant-scoped source metadata with checksum, revision marker, ingest timestamp, and active/inactive state.
- Re-ingesting unchanged content is deterministic and returns unchanged behavior without creating duplicate rows.
- New content revisions automatically roll active status forward and preserve previous source rows as inactive history.
- Runtime knowledge loading remains centralized in `src/lib/llm/knowledge.ts`.
- Onboarding SOP added for repeatable source naming, metadata requirements, ingestion workflow, and failure triage.

## Next recommended shift
- Shift 12E.2 - second-tenant ingestion pressure test and tenant-isolation retrieval assertions
