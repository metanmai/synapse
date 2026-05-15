import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@synapse/shared/handoff/types.js": path.resolve(__dirname, "../packages/shared/src/handoff/types.ts"),
      "@synapse/shared/handoff/events.js": path.resolve(__dirname, "../packages/shared/src/handoff/events.ts"),
      "@synapse/shared/handoff/reducer.js": path.resolve(__dirname, "../packages/shared/src/handoff/reducer.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
      "test/capture/**/*.test.ts",
    ],
    testTimeout: 30000,
  },
});
