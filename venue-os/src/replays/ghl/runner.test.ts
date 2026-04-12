import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runGhlReplaySuite } from "./runner";

describe("runGhlReplaySuite", () => {
  it("replays the default GHL fixture library through the shared webhook handler path", async () => {
    const result = await runGhlReplaySuite({
      runId: "test-ghl-replay-default",
      logger: {
        write: () => undefined,
      },
    });

    assert.equal(result.summary.total, 5);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.passed, 5);
    assert.ok(result.results.every((fixtureResult) => fixtureResult.pass));
  });

  it("supports replaying a single fixture by id", async () => {
    const result = await runGhlReplaySuite({
      runId: "test-ghl-replay-single",
      fixtureIds: ["note-hours-safe"],
      logger: {
        write: () => undefined,
      },
    });

    assert.equal(result.summary.total, 1);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.results[0]?.fixtureId, "note-hours-safe");
    assert.equal(result.results[0]?.actual.transportOutcome, "dry_run");
  });
});
