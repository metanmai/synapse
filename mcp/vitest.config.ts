import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

// Windows-only `singleFork: true`: works around vitest 4 + GHA worker-
// recycle crash that emits "Worker exited unexpectedly" after all tests
// pass. Linux/macOS keep default parallel multi-fork (faster).
// NOTE: vitest 4 requires pool/poolOptions at top level; nesting under
// `test` is a silent no-op (deprecation warning, no apply).
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
