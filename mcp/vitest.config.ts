import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts", "test/e2e/**/*.test.ts"],
    testTimeout: 30000,
  },
});
