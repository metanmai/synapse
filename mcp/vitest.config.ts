import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

// On Windows runners (vitest 4 + Node 24 + GHA), the default forks pool's
// worker teardown intermittently emits "Worker exited unexpectedly" AFTER
// all tests pass — failing the run with exit-1 despite 0 test failures.
// Running everything in a single fork sequentially eliminates the worker-
// recycling lifecycle that triggers it. Linux/macOS use the default
// multi-fork pool (faster). NOTE: vitest 4 moved `pool` and `poolOptions`
// from under `test.*` to top-level — putting them under `test` is a silent
// no-op (emits a deprecation warning but doesn't apply the setting).
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
  pool: "forks",
  poolOptions: {
    forks: isWindows ? { singleFork: true } : {},
  },
});
