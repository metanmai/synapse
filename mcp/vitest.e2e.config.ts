import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

// E2E-only vitest config. Collected separately from unit/integration so that
// `npm test` (which uses vitest.config.ts) does NOT pick these files up and
// report them as skipped — skip-by-non-collection beats skip-by-marker.
//
// Windows-only `singleFork: true`: works around vitest 4 + GHA worker-
// recycle crash that emits "Worker exited unexpectedly" after all tests
// pass. Linux/macOS keep default parallel multi-fork (faster).
// NOTE: vitest 4 requires pool/poolOptions at top level; nesting under
// `test` is a silent no-op (deprecation warning, no apply).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 30000,
  },
  pool: "forks",
  poolOptions: {
    forks: isWindows ? { singleFork: true } : {},
  },
});
