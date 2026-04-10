# Eval Runner

Shift 12B.1 adds a lightweight in-repo eval harness for deterministic local regression capture. The runner exercises the real conversation orchestrator, safe-send classifier, and response policy while swapping the live router/model calls for fixture-driven test outputs.

## Commands

```bash
pnpm evals:run
pnpm evals:baseline
```

- `pnpm evals:run` validates every fixture in `evals/cases/`, executes the suite locally, and writes the latest run artifact to `evals/results/latest/`.
- `pnpm evals:baseline` re-runs the same suite and refreshes the committed baseline snapshots in `evals/baselines/v1/`.

## Fixture format

Create one JSON file per case in `evals/cases/`.

```json
{
  "schemaVersion": 1,
  "id": "general-hours-safe",
  "description": "High-confidence hospitality answer should remain safe to send.",
  "clock": {
    "now": "2026-04-10T16:05:00.000Z"
  },
  "input": {
    "tenantId": "11111111-1111-4111-8111-111111111111",
    "venue": {
      "id": "22222222-2222-4222-8222-222222222222",
      "venueName": "Veritas Vineyard"
    },
    "conversation": {
      "id": "33333333-3333-4333-8333-333333333333",
      "status": "open"
    },
    "inbound": {
      "content": "What time do you close today?",
      "source": "eval_fixture",
      "role": "user",
      "receivedAt": "2026-04-10T16:04:00.000Z"
    }
  },
  "recentMessages": [],
  "router": {
    "classification": {
      "category": "general_hospitality",
      "confidence": 0.96,
      "requiresHumanReview": false,
      "rationale": "The guest is asking a standard venue-hours question."
    },
    "aiReply": "We are open until 5 PM today."
  }
}
```

### Required fixture pieces

- `clock.now`: fixed timestamp used to keep the run deterministic.
- `input`: validated with the same conversation-turn schema the orchestrator already uses.
- `recentMessages`: optional conversation history used as session memory for the turn.
- `router.classification`: validated route output.
- `router.aiReply`: deterministic draft content fed into the safe-send classifier and policy engine.

### Optional router overrides

- `router.replySource`: override whether the router behaves like a normal model reply or a premium holding response.
- `router.pricingVerification`
- `router.availabilityVerification`

Those verification overrides are useful when a fixture needs to simulate grounded fact approval without depending on live integrations.

## Validation behavior

Fixture loading fails fast on:

- invalid JSON
- missing required fields
- schema mismatches such as out-of-range confidence values
- duplicate case IDs

Validation errors include the fixture filename and the failing field path so bad cases are easy to fix.

## Baseline shape

Each run captures:

- route classification
- route confidence
- draft output
- policy decision
- policy reasons
- safe-send classifier state

Committed baselines live in `evals/baselines/v1/` with:

- `index.json` for the full suite summary
- `cases/<case-id>.json` for per-case snapshots

## Refresh workflow

1. Add or edit fixture files in `evals/cases/`.
2. Run `pnpm evals:run` to validate the suite locally.
3. Run `pnpm evals:baseline` to refresh committed snapshots when the new output is intentional.
4. Review the baseline diff before committing.
