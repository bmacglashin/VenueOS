import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  loadEvalFixtures,
  runEvalSuite,
  writeEvalArtifacts,
} from "./runner";

const VALID_FIXTURE = {
  schemaVersion: 1,
  id: "pricing-review-case",
  description: "Pricing language should force review when unverified.",
  clock: {
    now: "2026-04-10T16:00:00.000Z",
  },
  input: {
    tenantId: "11111111-1111-4111-8111-111111111111",
    venue: {
      id: "22222222-2222-4222-8222-222222222222",
      venueName: "Test Venue",
    },
    conversation: {
      id: "33333333-3333-4333-8333-333333333333",
      ghlContactId: "contact-123",
      ghlConversationId: "conversation-123",
      status: "open",
    },
    inbound: {
      content: "Can you share pricing for the room?",
      source: "eval_fixture",
      role: "user",
      receivedAt: "2026-04-10T15:59:00.000Z",
    },
  },
  recentMessages: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      role: "user",
      direction: "inbound",
      content: "We are exploring your venue for an event.",
      source: "eval_fixture",
      status: "recorded",
      createdAt: "2026-04-10T15:55:00.000Z",
    },
  ],
  router: {
    classification: {
      category: "general_hospitality",
      confidence: 0.94,
      requiresHumanReview: false,
      rationale: "The guest is asking a standard venue question.",
    },
    aiReply: "Our room fee is $2,500 plus tax for this package.",
  },
} as const;

async function writeFixture(
  directoryPath: string,
  fileName: string,
  value: unknown
) {
  await writeFile(path.join(directoryPath, fileName), JSON.stringify(value));
}

describe("loadEvalFixtures", () => {
  it("loads valid fixtures and sorts them by case id", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "venue-os-evals-"));

    try {
      await writeFixture(tempRoot, "b-case.json", {
        ...VALID_FIXTURE,
        id: "zzz-case",
      });
      await writeFixture(tempRoot, "a-case.json", {
        ...VALID_FIXTURE,
        id: "aaa-case",
      });

      const fixtures = await loadEvalFixtures(tempRoot);

      assert.deepEqual(
        fixtures.map((fixture) => fixture.id),
        ["aaa-case", "zzz-case"]
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails with a clear validation message for bad fixtures", async () => {
    const invalidRoot = await mkdtemp(path.join(tmpdir(), "venue-os-evals-"));

    try {
      await writeFixture(invalidRoot, "invalid.json", {
        ...VALID_FIXTURE,
        router: {
          ...VALID_FIXTURE.router,
          classification: {
            ...VALID_FIXTURE.router.classification,
            confidence: 1.5,
          },
        },
      });

      await assert.rejects(
        () => loadEvalFixtures(invalidRoot),
        /Invalid eval fixture invalid\.json: router\.classification\.confidence: Too big/
      );
    } finally {
      await rm(invalidRoot, { recursive: true, force: true });
    }
  });
});

describe("runEvalSuite", () => {
  it("captures route, draft, and policy output for deterministic fixtures", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "venue-os-evals-"));

    try {
      await writeFixture(tempRoot, "pricing.json", VALID_FIXTURE);

      const fixtures = await loadEvalFixtures(tempRoot);
      const artifact = await runEvalSuite(fixtures);

      assert.equal(artifact.totalCases, 1);
      assert.equal(artifact.cases[0]?.route.classification, "general_hospitality");
      assert.equal(artifact.cases[0]?.policy.decision, "needs_review");
      assert.deepEqual(
        artifact.cases[0]?.policy.reasons.map((reason) => reason.code),
        ["pricing_unverified"]
      );

      const outputRoot = path.join(tempRoot, "output");
      await writeEvalArtifacts(outputRoot, artifact);

      const writtenIndex = JSON.parse(
        await readFile(path.join(outputRoot, "index.json"), "utf8")
      ) as { totalCases: number };

      assert.equal(writtenIndex.totalCases, 1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
