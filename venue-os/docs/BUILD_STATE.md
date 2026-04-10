# Build State

## Completed shifts
- Shift 1 - repo source of truth (complete)
- Shift 2 - dependencies + config (complete)
- Shift 3 - AI service (complete)

## Current branch
- `feat/shift-03-ai-service`

## Files changed this shift
- `package-lock.json`
- `src/services/ai.ts`
- `docs/BUILD_STATE.md`

## Validation run
- `npm install`
- `npx tsc --noEmit`
- `npm run lint`

## Blockers / open questions
- None at the end of Shift 3.

## Env readiness
- Server-only AI service now reads `GOOGLE_GENERATIVE_AI_API_KEY` and `GOOGLE_MODEL` through validated env config.
- Google provider wiring is centralized behind `runVenueModel()` so routes and future sandbox flows do not import provider SDKs directly.

## Next recommended shift
- Shift 4 - knowledge loading + caching
