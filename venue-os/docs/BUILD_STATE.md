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

## Current branch
- `feat/shift-12b-route-scoring-redteam`

## Files changed this shift
- `src/lib/llm/route-contract.ts`
- `src/lib/llm/router.ts`
- `src/services/response-policy.ts`
- `src/services/safe-send-classifier.ts`
- `src/services/safe-send-classifier.test.ts`
- `src/evals/fixture-schema.ts`
- `src/evals/runner.ts`
- `src/evals/runner.test.ts`
- `scripts/evals/run.ts`
- `scripts/evals/baseline.ts`
- `evals/cases/*.json`
- `evals/baselines/v2/*`
- `docs/EVALS.md`
- `README.md`
- `package.json`
- `docs/BUILD_STATE.md`

## Validation run
- `npm test`
- `npm run evals:run`
- `npm run evals:baseline`
- `npm run lint`

## Blockers / open questions
- None for the local eval harness itself. This shift intentionally does not add LLM-as-judge scoring, CI gating, or a broader analytics surface.

## Env readiness
- Eval fixtures now live in `evals/cases/` as validated per-case JSON files with route expectations, category metadata, and deterministic outcome assertions.
- The runner executes the real orchestrator, safe-send classifier, outbound-control logic, and response policy with a deterministic fixture-driven router test mode.
- Latest local run artifacts are written to `evals/results/latest/` and ignored from git.
- Committed regression baselines are versioned under `evals/baselines/v2/`.
- Fixture validation fails clearly on malformed JSON, schema mismatches, and duplicate case IDs.
- Local tests now cover fixture parsing, deterministic scoring/reporting, and the availability guardrail classifier path.
- Reports now include overall score, route rollups, category rollups, and failed-case explanations.

## Next recommended shift
- Shift 12B.3 - CI gating and regression-threshold enforcement for eval score changes
