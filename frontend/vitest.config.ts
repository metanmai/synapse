import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
    alias: {
      $lib: "/src/lib",
      "$lib/*": "/src/lib/*",
      "$app/environment": "/src/test-mocks/app-environment.ts",
      "$env/static/private": "/src/test-mocks/env-private.ts",
    },
  },
});
