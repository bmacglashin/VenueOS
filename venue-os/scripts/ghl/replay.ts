import {
  formatGhlReplaySummary,
  runGhlReplaySuite,
} from "../../src/replays/ghl/runner";
import { listGhlReplayFixtures } from "../../src/replays/ghl/fixture-library";

interface ParsedArgs {
  fixtureIds: string[];
  runId?: string;
  listOnly: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    fixtureIds: [],
    listOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--fixture") {
      const fixtureId = argv[index + 1];

      if (fixtureId == null) {
        throw new Error("Expected a fixture id after --fixture.");
      }

      parsed.fixtureIds.push(fixtureId);
      index += 1;
      continue;
    }

    if (current === "--run-id") {
      const runId = argv[index + 1];

      if (runId == null) {
        throw new Error("Expected a run id after --run-id.");
      }

      parsed.runId = runId;
      index += 1;
      continue;
    }

    if (current === "--list") {
      parsed.listOnly = true;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.listOnly) {
    process.stdout.write("Available GHL replay fixtures:\n");

    for (const fixture of listGhlReplayFixtures()) {
      process.stdout.write(
        `- ${fixture.id} [${fixture.entity}] ${fixture.description}\n`
      );
    }

    return;
  }

  const result = await runGhlReplaySuite({
    runId: args.runId,
    fixtureIds: args.fixtureIds,
  });

  process.stdout.write(`${formatGhlReplaySummary(result)}\n`);

  if (result.summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "GHL replay harness failed unexpectedly.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
