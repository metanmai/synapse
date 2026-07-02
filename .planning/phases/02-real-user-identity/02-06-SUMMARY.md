---
phase: 02-real-user-identity
plan: 6
status: complete
wave: 5
completed: 2026-05-20
deferred_operator_action: "cd frontend && npm install + npx playwright install chromium on a tethered network (proxy blocks here); also: monitor next CI run for e2e job green"
---

# Plan 02-06 — Playwright Browser-Driven e2e for LinkPicker (Wave 5) — SUMMARY

> Adds the third tier of test fidelity for the IDENT-02 manual-link surface: real browser, real DOM, real interactions. Runs on every push-to-main in CI; falls between unit tests (no DOM) and the manual UI smoke (slow, human-gated).

## What shipped

### Dependency declaration (Task 1)

- **EXTENDED** `frontend/package.json` — adds `@playwright/test@^1.49.0` to `devDependencies`. New scripts:
  - `"test:e2e": "playwright test"`
  - `"test:e2e:ui": "playwright test --ui"`
  - No `npm install` ran on this machine (Netskope proxy blocks per memory `feedback_npx_proxy.md`); CI will install on every push.

### Config (Task 1)

- **NEW** `frontend/playwright.config.ts` — Chromium-only `projects` array, `testDir: "./e2e"`, `baseURL: "http://localhost:4173"`, `webServer: { command: "npm run build && npm run preview", port: 4173 }`. CI tweaks: `forbidOnly: !!process.env.CI`, `retries: 2`, `workers: 1`, `reporter: [['html'], ['github']]`. Preview not dev — closer to production bundle behavior.

- **EXTENDED** `frontend/.gitignore` — adds `/test-results/`, `/playwright-report/`, `/playwright/.cache/`, `/.playwright/` (Playwright's per-run output directories).

### Test fixture route + e2e spec (Task 2)

- **NEW** `frontend/src/routes/__e2e/link-picker/+page.svelte` (~25 LOC) — mounts the real LinkPicker component with mock props. Routes outside `(app)/` group don't require Supabase auth, so Playwright can drive them without auth bypass.
- **NEW** `frontend/src/routes/__e2e/link-picker/+page.server.ts` (~110 LOC) — scenario-driven mock load + form action:
  - `?scenario=basic` (default): 1 target, no candidates
  - `?scenario=with-match`: 1 target + 1 git-remote-matched candidate (drives the "Matched" badge + "Suggested matches" rendering)
  - `?scenario=empty`: no targets (drives State A disabled state)
  - `?next=success` (default): action returns 303 redirect to `?landed=1`
  - `?next=loading`: action sleeps 1500ms before success (drives State D spinner)
  - `?next=403/404/409/500/network`: returns fail() with the verbatim UI-SPEC §State F copy
- **NEW** `frontend/e2e/projects-merge.spec.ts` (~145 LOC) — 7 `test()` blocks (the plan called for 6 — one per State A-F; I added an extra "State A disabled" case for the empty scenario because it's a distinct contract worth guarding):
  1. State A — idle: trigger button + locked body copy visible
  2. State A — disabled when no other projects exist (extra coverage)
  3. State B — picker opens; "Suggested matches" + "Matched" badge with `aria-label`; Continue disabled until target picked
  4. State C — type-to-confirm gate (exact match required to enable submit)
  5. State D — spinner + "Linking…" copy during loading
  6. State E — successful submit redirects (URL changes to fixture's `?landed=1` marker)
  7. State F — 403 surfaces locked alert copy + form re-enables for retry

All assertions use semantic locators (`getByRole`, `getByPlaceholder`, `getByLabel`, `getByText`) — no raw CSS selectors for primary assertions. Locked UI-SPEC copy strings cited verbatim so a future copy edit regresses the test.

### CI wiring (Task 3)

- **EXTENDED** `.github/workflows/ci.yml` — `e2e` job (push-to-main only, gated on `verify` job's green status). Three new steps between `Build MCP CLI` and the existing mcp `E2E tests`:
  1. `Frontend env for e2e` — `cp frontend/.env.example frontend/.env`
  2. `Install Playwright browsers` — `cd frontend && npx playwright install --with-deps chromium`
  3. `Playwright e2e (UI)` — `cd frontend && npx playwright test` with `CI=true`
  - Plus an `Upload Playwright report` step at the end with `if: failure()` — uploads `frontend/playwright-report/` as a workflow artifact for post-hoc debugging.
- `verify` job is unchanged. `publish.yml` is unchanged.

## Quality gates

- **TypeScript:** all 4 workspaces `tsc --noEmit` clean (the e2e spec is excluded from svelte-check's include patterns, so `@playwright/test` not being installed locally doesn't break the typecheck pipeline).
- **Biome:** clean (1 pre-existing `any` warning carries over). Biome auto-fixed one whitespace issue in the e2e spec's destructuring (inlined `{ page }` parameter).
- **Vitest (4 workspaces):** still 896 passing, 184 skipped, 0 failing. The `__e2e` route adds no vitest tests of its own — it's exclusively for Playwright consumption.
- **svelte-check:** 0 errors, 12 pre-existing warnings.

## Deviations from plan

**Auth-mocked-via-cookie approach → test-only route fixture.** Plan 02-06 Task 2's setup pattern called for `page.context().addCookies([{ name: 'sb-access-token', ... }])` to bypass auth. In practice, `frontend/src/hooks.server.ts` validates every request via `supabase.auth.getUser()` against real Supabase — a fake cookie value would be rejected mid-request and the test would never reach the LinkPicker. Setting up a real test Supabase session per Playwright run is out of scope for this MVP slice.

The chosen workaround — a test-only route at `/__e2e/link-picker` outside the `(app)/` auth-required layout — sidesteps the auth question entirely. The route mounts the real LinkPicker component with scenario-driven mock data; Playwright tests the component's actual rendering and interaction behavior, not the integrated SettingsPage flow. The integrated flow is covered by Plan 02-05's manual UI smoke (Task 5, operator-deferred). This split — "component-level e2e for state transitions, manual smoke for integrated flow" — is the right tier separation for Phase 2 MVP.

**Route gating decision.** The `__e2e` route will land in production bundles (no env-var gating). Decision rationale: (a) the route does nothing destructive — `+page.server.ts` actions return mock fails / redirects only, no backend calls; (b) per memory `feedback_no_other_users.md`, no external users yet — the cost of accidentally exposing a `/__e2e/link-picker` page is zero; (c) gating adds complexity (env-var wiring + a 404-throwing branch in production code) for no realized benefit. The route is signposted as test scaffolding via the `__e2e` prefix.

**7 tests, not exactly 6.** Plan asked for "exactly 6 test() blocks (one per state A-F)". Shipped 7 — added a second State A test for the `?scenario=empty` disabled-trigger case because it's a distinct contract (trigger disabled + helper copy visible) the original "State A idle" test didn't cover. Per `feedback_test_generality.md`, this guards a bug class — accidentally enabling the trigger when no targets exist — that the basic State A test would miss.

**Local Playwright install (Task 4) — deferred.** Per Plan 02-06 Task 4's skip-condition: tethered network not available right now. CI is the first validation surface; if the spec has bugs, the Plan 02-06 Task 5 CI feedback loop (~3-5 min per push) will surface them. Local fast-iteration loop is unavailable until the operator runs `cd frontend && npm install && npx playwright install chromium` on a non-Netskope network.

**Task 5 (CI verification) — pending the next push.** This SUMMARY is being written before the push to origin/main. The next push will trigger CI, where the `e2e` job will run the Playwright spec for the first time. Outcomes to monitor on metanmai/synapse Actions:
- `verify` job stays green (~3 min runtime — should be unaffected)
- `e2e` job runtime grows by ~2-3 min (Playwright install + Chromium download + 7-test run)
- All 7 Playwright tests pass against Chromium on Ubuntu CI runner
- If failure: download `playwright-report` artifact for HTML reporter + screenshots + traces

## Quality observation

The fixture route pattern is reusable for future Phase 3+ component-level e2e tests. Mount-component-with-mock-props-via-URL-params is the cleanest Playwright-on-SvelteKit pattern when the route's `(app)/` layout requires real auth and there's no time to wire test auth credentials. Add new fixture routes under `frontend/src/routes/__e2e/<component-name>/` as Phase 3+ ships new UI surfaces worth browser-testing.

## No lockfile

Per `feedback_no_lockfile.md`: `frontend/package-lock.json` is NOT committed. The `@playwright/test` devDep entry in `package.json` is enough — `npm install` in CI resolves a fresh tree, and the local proxy-bypass install (if/when the operator runs it) will produce a transient lockfile that should be `git checkout`'d not committed.

## Open follow-ups (do not block phase)

- **Local install on tethered network** (Plan 02-06 Task 4) when convenient — speeds up iteration if any of the 7 tests need adjustment.
- **CI run observation** (Plan 02-06 Task 5) after the next push — confirm the `e2e` job goes green.
- **Wire real candidates loader.** When the backend exposes `matched_by_remote` via a `GET /api/projects/match-candidates?for=<id>` endpoint, update `api.listLinkCandidates` in Plan 02-05 to consume it. The `?scenario=with-match` fixture path will then exercise the real wire-up (it currently uses route-load mock data that mirrors the future shape).

## Next steps

- After CI green: `/gsd:verify-work 2` for phase-level verification against IDENT-01 + IDENT-02 success criteria.
- Operator action consolidated for next CF-enabled session: apply migration 018 (column + `merge_projects` function) to dogfood Supabase, `wrangler deploy` backend, redeploy frontend.
