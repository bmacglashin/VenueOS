import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVAL_BASELINE_VERSION,
  runEvalSuiteFromDirectory,
  writeEvalArtifacts,
} from "../../src/evals/runner";

const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const repoRootPath = path.resolve(scriptDirectoryPath, "..", "..");
const casesDirectoryPath = path.join(repoRootPath, "evals", "cases");
const outputDirectoryPath = path.join(
  repoRootPath,
  "evals",
  "baselines",
  EVAL_BASELINE_VERSION
);

async function main() {
  const artifact = await runEvalSuiteFromDirectory(casesDirectoryPath);

  await writeEvalArtifacts(outputDirectoryPath, artifact);

  console.log(
    `Refreshed ${artifact.totalCases} eval baseline(s) in ${path.relative(
      repoRootPath,
      outputDirectoryPath
    )}.`
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Baseline capture failed unexpectedly."
  );
  process.exitCode = 1;
});
