import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

// On Windows runners (vitest 4 + Node 24 + GHA), the default forks pool's
// child-process teardown intermittently emits "Worker exited unexpectedly"
// AFTER all tests pass — failing the run with exit-1 despite 0 test
// failures. Threads pool runs tests inside worker_threads (no child
// process), so there's no "worker exited" path to trip. Linux/macOS keep
// the default forks pool (more robust isolation for our suite).
// NOTE: vitest 4 moved `pool`/`poolOptions` from under `test.*` to top-
// level. Putting them under `test` is a silent no-op.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
      "test/capture/**/*.test.ts",
      "test/hooks/**/*.test.ts",
      "test/cli/**/*.test.ts",
      "test/perf/**/*.test.ts",
    ],
    testTimeout: 30000,
  },
  pool: isWindows ? "threads" : "forks",
});
