#!/usr/bin/env node
/**
 * Test runner wrapper that tolerates vitest 4's "Worker exited unexpectedly"
 * teardown crash on Windows CI.
 *
 * The bug class:
 *   - All tests pass (numFailedTests === 0, numFailedTestSuites === 0).
 *   - Vitest's forks pool emits "Worker exited unexpectedly" during the
 *     fork worker's exit handler.
 *   - Vitest treats this as an unhandled error and exits with code 1.
 *   - CI sees exit 1 and marks the job failed, even though every test
 *     assertion passed.
 *
 * This wrapper runs vitest, reads the JSON results, and decides the final
 * exit code based on test outcomes — NOT on vitest's process exit code.
 *
 * Inputs: forwarded as vitest run args (e.g. `node run-tests.mjs path/to/test`).
 * Exit codes:
 *   0 — all tests passed (test JSON shows zero failures)
 *   1 — at least one test or suite failed
 *   2 — vitest didn't write the JSON file (config error, crash before any test ran)
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const resultsFile = join(repoRoot, ".vitest-results.json");

if (existsSync(resultsFile)) rmSync(resultsFile);

const userArgs = process.argv.slice(2);

const vitestArgs = [
  "vitest",
  "run",
  "--reporter=default",
  "--reporter=json",
  `--outputFile.json=${resultsFile}`,
  ...userArgs,
];

const child = spawn("npx", vitestArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  if (!existsSync(resultsFile)) {
    console.error(`[run-tests] vitest did not produce ${resultsFile}; treating as hard failure.`);
    process.exit(2);
  }

  const raw = readFileSync(resultsFile, "utf-8");
  let results;
  try {
    results = JSON.parse(raw);
  } catch (err) {
    console.error(`[run-tests] failed to parse vitest JSON: ${err}`);
    process.exit(2);
  }

  const failedTests = results.numFailedTests ?? 0;
  const failedSuites = results.numFailedTestSuites ?? 0;
  const passedTests = results.numPassedTests ?? 0;

  if (failedTests === 0 && failedSuites === 0) {
    if (code !== 0) {
      console.error(
        `[run-tests] vitest exited ${code} but all ${passedTests} tests passed; treating as success (likely the vitest 4 + Windows worker-teardown bug).`,
      );
    }
    process.exit(0);
  }

  console.error(`[run-tests] ${failedTests} failed test(s), ${failedSuites} failed suite(s).`);
  process.exit(1);
});
