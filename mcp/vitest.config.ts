import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

// On Windows runners (vitest 4 + Node 24 + GHA), the forks pool's child-
// process teardown intermittently emits "Worker exited unexpectedly"
// AFTER all tests pass — failing the run with exit-1 despite 0 test
// failures. The mcp suite relies on process-level isolation (vi.spyOn
// (process,"exit"), env mutation) so we can't switch to threads.
// `singleFork: true` + `isolate: false` keeps one fork worker alive
// across all test files — no worker recycling, so no teardown crash.
// Linux/macOS keep default parallel multi-fork (faster, more
// isolated).
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
    isolate: !isWindows,
  },
  pool: "forks",
  poolOptions: {
    forks: isWindows ? { singleFork: true } : {},
  },
});
