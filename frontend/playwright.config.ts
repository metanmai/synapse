import { defineConfig, devices } from "@playwright/test";

// Phase 2 (IDENT-02, Plan 02-06): browser-driven e2e for the LinkPicker UI.
// Chromium-only (Phase 2 doesn't need multi-browser coverage; the inline-expand
// picker doesn't use any browser-specific primitives). Preview (not dev) so
// the bundle reflects production behavior — closer to what users see.
//
// CI runs this on push-to-main only; PRs don't run e2e per existing CI setup.
// Backend is mocked via page.route() in the spec file — no test Supabase
// dependency for this surface.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html"], ["github"]] : "list",

  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run build && npm run preview",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    // Unlock the Playwright-only `/__e2e/*` fixture routes. The fixtures
    // 404 in `vite preview` (production-shaped bundle) without this flag —
    // see frontend/src/routes/__e2e/link-picker/+page.server.ts. Real
    // production deployments never pass this env, so the routes stay
    // closed there.
    env: { ENABLE_E2E_FIXTURES: "1" },
  },
});
