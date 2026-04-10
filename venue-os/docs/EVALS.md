# Eval Runner

Shift 12B.2 extends the in-repo eval harness with deterministic route-aware scoring, category rollups, and a starter red-team suite. The runner still exercises the real conversation orchestrator, safe-send classifier, outbound control, and response policy while swapping live router/model calls for fixture-driven outputs.

## Commands

```bash
pnpm evals:run
pnpm evals:baseline
```

- `pnpm evals:run` validates every fixture in `evals/cases/`, executes the suite locally, and writes the latest artifact to `evals/results/latest/`.
- `pnpm evals:baseline` re-runs the suite and refreshes the committed baseline snapshots in `evals/baselines/v2/`.

Both commands print a readable console report with:

- overall score
- score by route
- score by category
- failed cases with the exact checks that failed

## Fixture format

Create one JSON file per case in `evals/cases/`.

```json
{
  "schemaVersion": 1,
  "id": "pricing-review",
  "category": "pricing_trap",
  "description": "Unverified pricing language must stay in review and never look safe to send.",
  "clock": {
    "now": "2026-04-10T16:15:00.000Z"
  },
  "input": {
    "tenantId": "99999999-9999-4999-8999-999999999999",
    "venue": {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "venueName": "Veritas Vineyard"
    },
    "conversation": {
      "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "status": "open"
    },
    "inbound": {
      "content": "Can you share pricing for a private event?",
      "source": "eval_fixture",
      "role": "user",
      "receivedAt": "2026-04-10T16:14:00.000Z"
    }
  },
  "recentMessages": [],
  "router": {
    "classification": {
      "category": "general_hospitality",
      "confidence": 0.94,
      "requiresHumanReview": false,
      "rationale": "The guest is asking a standard venue question."
    },
    "aiReply": "Our room fee is $2,500 plus tax for this package."
  },
  "expect": {
    "policy": {
      "decision": "needs_review",
      "reasonCodes": ["pricing_unverified"]
    },
    "safeSend": {
      "escalationSignal": false,
      "pricingDiscussed": true,
      "pricingVerification": "unverified"
    },
    "outbound": {
      "action": "queue",
      "draftStatus": "queued_for_review"
    }
  },
  "overrides": {}
}
```

## Required fixture pieces

- `category`: suite bucket used by the report. Current buckets are `baseline_control`, `ambiguity`, `policy_uncertainty`, `pricing_trap`, `escalation`, and `missing_context`.
- `clock.now`: fixed timestamp used to keep the run deterministic.
- `input`: validated with the same conversation-turn schema the orchestrator uses.
- `router.classification`: deterministic route output fed into orchestration.
- `router.aiReply`: deterministic draft content passed into safe-send classification and policy evaluation.
- `expect.policy`: expected decision and exact reason-code list.
- `expect.outbound`: expected review-vs-send action and optional draft status.

## Optional fixture pieces

- `recentMessages`: deterministic session memory.
- `router.replySource`
- `router.pricingVerification`
- `router.availabilityVerification`
- `expect.safeSend.*`: use these when a case should assert escalation or pricing/availability guardrail behavior explicitly.
- `overrides.policy.tenantState`
- `overrides.policy.inboundBodyState`
- `overrides.outboundMode.globalMode`
- `overrides.outboundMode.tenantOverride`

The override hooks are useful for cases that need to simulate upstream normalization or delivery-mode states without changing the production orchestrator contract.

## Deterministic scorers

The report applies route-aware deterministic checks for:

- classification correctness
- policy decision correctness
- escalation correctness
- pricing and availability guardrail correctness
- review-vs-send correctness

Each case file stores the expectations that power those checks, so future regressions fail with a concrete expected-vs-actual explanation.

## Report shape

Each run writes:

- `index.json`: full artifact including case outputs and the aggregated report
- `report.json`: concise report-only view
- `cases/<case-id>.json`: per-case output plus the individual scoring checks

The aggregated report includes:

- overall check score and case pass count
- score by route
- score by category
- failed case list with the specific failed checks and why each one failed

## Validation behavior

Fixture loading fails fast on:

- invalid JSON
- missing required fields
- schema mismatches such as out-of-range confidence values
- duplicate case IDs

Validation errors include the fixture filename and failing field path so bad cases are easy to fix.

## Expanding the suite

1. Pick the category the case belongs to.
2. Add the deterministic router output you want to simulate.
3. Fill in `expect.policy` and `expect.outbound` first.
4. Add `expect.safeSend` whenever the case is about escalation or pricing/availability traps.
5. Use `overrides.policy` for missing-tenant or missing-body coverage instead of weakening the production request schema.
6. Run `pnpm evals:run` and confirm the new case passes with the expected route/category rollups.
7. Run `pnpm evals:baseline` when the new output is intentional and review the baseline diff before committing.
