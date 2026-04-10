import path from "node:path";
import { fileURLToPath } from "node:url";

import { runEvalSuiteFromDirectory, writeEvalArtifacts } from "../../src/evals/runner";

const scriptDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const repoRootPath = path.resolve(scriptDirectoryPath, "..", "..");
const casesDirectoryPath = path.join(repoRootPath, "evals", "cases");
const outputDirectoryPath = path.join(repoRootPath, "evals", "results", "latest");

async function main() {
  const artifact = await runEvalSuiteFromDirectory(casesDirectoryPath);

  await writeEvalArtifacts(outputDirectoryPath, artifact);

  console.log(
    `Ran ${artifact.totalCases} eval fixture(s). Results written to ${path.relative(
      repoRootPath,
      outputDirectoryPath
    )}.`
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Eval runner failed unexpectedly."
  );
  process.exitCode = 1;
});
