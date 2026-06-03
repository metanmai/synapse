---
phase: 02-real-user-identity
plan: 6
type: execute
wave: 5
depends_on: ["02-05"]
files_modified:
  - frontend/package.json
  - frontend/playwright.config.ts
  - frontend/e2e/projects-merge.spec.ts
  - frontend/.gitignore
  - .github/workflows/ci.yml
autonomous: false
requirements: [IDENT-02]
threat_refs: []

must_haves:
  truths:
    - "Playwright test for the LinkPicker covers all 6 states locked by 02-UI-SPEC.md (A idle / B picker / C type-to-confirm / D loading / E success / F error)"
    - "Tests run in CI's existing e2e job (gated to push-to-main per .github/workflows/ci.yml) and exit 0 against Chromium"
    - "Backend is mocked via Playwright's page.route() — no test Supabase dependency for this plan; the existing TEST_SUPABASE_* secrets in the e2e job are reused only by the mcp e2e tests already in that job"
    - "Local developer workflow documented: install Playwright once on a tethered network (Netskope proxy blocks npm install otherwise); subsequent pushes don't require re-install since CI does its own npm install"
    - "No lockfile committed — only frontend/package.json devDeps change (per feedback_no_lockfile.md)"
  artifacts:
    - path: "frontend/playwright.config.ts"
      provides: "Playwright config — Chromium-only project, webServer block runs npm run preview"
      contains: "defineConfig"
    - path: "frontend/e2e/projects-merge.spec.ts"
      provides: "6 Playwright test() blocks covering LinkPicker states A-F"
      contains: "test('State A"
    - path: ".github/workflows/ci.yml"
      provides: "e2e job extended with Playwright install + run steps"
      contains: "playwright install --with-deps chromium"
  key_links:
    - from: "frontend/e2e/projects-merge.spec.ts"
      to: "frontend/src/lib/components/project-link/LinkPicker.svelte"
      via: "Playwright navigates to /projects/[name]/settings and interacts with LinkPicker"
      pattern: "page\\.goto.*settings"
    - from: ".github/workflows/ci.yml"
      to: "frontend/playwright.config.ts"
      via: "CI step runs `cd frontend && npx playwright test` after `npm install` + `npx playwright install --with-deps chromium`"
      pattern: "playwright test"
---

<objective>
Add Playwright browser-driven e2e coverage for the LinkPicker UI surface (Slice C from Plan 02-05). Covers the 6 UI states locked by 02-UI-SPEC.md against a mocked backend — fast, deterministic, no test-Supabase dependency. Runs in CI's existing `e2e` job (gated to push-to-main, already wired in `.github/workflows/ci.yml`).

This plan closes Gap 1 from the post-plan-checker review: "no browser/UI e2e tests — manual UI smoke catches first-run regressions but not the 100th run." Playwright IS the regression net the manual smoke can't be.

Purpose: deliver automated regression coverage for the IDENT-02 manual-link UI so that future PRs (Phase 3+) touching `LinkPicker.svelte`, `frontend/src/routes/(app)/projects/[name]/settings/+page.svelte`, or any shared styling tokens get caught at CI time rather than at dogfood-discovery time. This is the test fidelity tier between "unit tests (fast, no UI)" and "manual smoke (slow, human-gated)" — covers things only a real browser sees: focus management, keyboard navigation, aria-live announcements, click-vs-Enter event handling, DOM ordering, visual disabled states.

Output: 4 NEW files + 2 EXTENDED files. Backend is mocked via `page.route()` in the test file itself — no fixtures committed, no test backend touched.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-real-user-identity/02-CONTEXT.md
@.planning/phases/02-real-user-identity/02-RESEARCH.md
@.planning/phases/02-real-user-identity/02-UI-SPEC.md
@.planning/phases/02-real-user-identity/02-PATTERNS.md
@.planning/phases/02-real-user-identity/02-05-manual-link-ui-PLAN.md
@.planning/codebase/CONVENTIONS.md
@CLAUDE.md
</context>

<tasks>

<task type="auto">
<id>02-06-T1</id>
<name>Install Playwright (config + dep manifest, no test execution yet)</name>
<read_first>
- frontend/package.json (current devDeps + scripts)
- frontend/.gitignore (current ignore patterns)
- frontend/svelte.config.js (adapter and preview command — Playwright's webServer config must match what `npm run preview` actually starts)
- frontend/vite.config.ts (existing test config — Playwright must NOT conflict with vitest's `test` block)
- .planning/phases/02-real-user-identity/02-UI-SPEC.md (locked copy strings — Playwright assertions use these verbatim, so the test file references them)
</read_first>

<action>
1. Add `@playwright/test` to `frontend/package.json` `devDependencies` at version `^1.49.0` (latest stable as of 2026-05). Add scripts: `"test:e2e": "playwright test"` and `"test:e2e:ui": "playwright test --ui"` to `frontend/package.json` `scripts`.

2. Write `frontend/playwright.config.ts` with:
   - `defineConfig` from `@playwright/test`
   - `testDir: './e2e'`
   - `fullyParallel: true`
   - `forbidOnly: !!process.env.CI` (CI must not allow `test.only`)
   - `retries: process.env.CI ? 2 : 0`
   - `workers: process.env.CI ? 1 : undefined` (serialize on CI for determinism)
   - `reporter: process.env.CI ? [['html'], ['github']] : 'list'`
   - `use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' }`
   - `projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]` (single browser per scope decision)
   - `webServer: { command: 'npm run build && npm run preview', port: 4173, reuseExistingServer: !process.env.CI, timeout: 120 * 1000 }` (preview, NOT dev — closer to production behavior)

3. Add to `frontend/.gitignore`:
   - `/test-results/`
   - `/playwright-report/`
   - `/playwright/.cache/`
   - `/.playwright/`

4. **Do NOT run `npm install` in this task.** Per CLAUDE.md + memory `feedback_npx_proxy.md`, the Netskope corporate proxy blocks npm package downloads on this machine. The dep is declared in package.json; actual install happens in Task 4 (human-verify checkpoint) on a tethered network OR in CI on every push (CI has no proxy issue).

5. Do NOT commit `package-lock.json` (per memory `feedback_no_lockfile.md`).
</action>

<verify>
<automated>cat frontend/package.json | grep -E "@playwright/test|test:e2e" | head -5 && cat frontend/playwright.config.ts | head -3 && cat frontend/.gitignore | grep -E "test-results|playwright-report"</automated>
</verify>

<acceptance_criteria>
- `frontend/package.json` contains `"@playwright/test"` in devDependencies
- `frontend/package.json` `scripts` contains `"test:e2e": "playwright test"`
- `frontend/playwright.config.ts` exists and starts with `import { defineConfig, devices }`
- `frontend/playwright.config.ts` declares `projects: [{ name: 'chromium', ... }]` (no Firefox / WebKit projects)
- `frontend/playwright.config.ts` declares `webServer` block with `command: 'npm run build && npm run preview'`
- `frontend/.gitignore` contains `/playwright-report/` and `/test-results/`
- No `package-lock.json` modifications staged (`git diff --staged --name-only | grep package-lock.json` returns empty)
</acceptance_criteria>

<done>
Playwright is declared in frontend/package.json and configured via playwright.config.ts. No install attempted on this machine (proxy-blocked); CI will install on next push. Test file written in Task 2 will fail locally (deps not installed) but will run in CI.
</done>
</task>

<task type="auto">
<id>02-06-T2</id>
<name>Write LinkPicker e2e spec covering 6 UI states with mocked backend</name>
<read_first>
- .planning/phases/02-real-user-identity/02-UI-SPEC.md (PRIMARY — all 6 states with locked copy strings, state machine diagram, copywriting contract; the spec IS the test oracle)
- frontend/src/lib/components/account/DangerZone.svelte (the type-to-confirm precedent the picker mirrors — Playwright assertions for State C should be patterned the same way)
- frontend/src/routes/(app)/projects/[name]/settings/+page.svelte (post-02-05 — confirm route shape + how LinkPicker is mounted; Playwright navigates here)
- frontend/src/lib/components/project-link/LinkPicker.svelte (post-02-05 — the component under test; Playwright assertions match its DOM IDs and aria attrs)
- .planning/phases/02-real-user-identity/02-05-manual-link-ui-PLAN.md (Task 5 — the manual smoke walkthrough Playwright IS automating)
</read_first>

<action>
Create `frontend/e2e/projects-merge.spec.ts` with one `test.describe('LinkPicker', ...)` block containing 6 `test()` cases — one per state.

**Setup pattern (shared across all tests):**
- Mock auth: `page.context().addCookies([{ name: 'sb-access-token', value: 'fake-test-token', domain: 'localhost', path: '/' }])` (or whatever the actual auth cookie name is — read from the existing dashboard code; Playwright reuses real production auth flow)
- Mock the merge endpoint: `await page.route('**/api/projects/*/merge-into/*', async (route) => { await route.fulfill({ status: 200, json: { ok: true, project_id: 'target-uuid' } }) })`
- Mock the projects-list endpoint: `await page.route('**/api/projects', async (route) => { await route.fulfill({ status: 200, json: [{ id: 'source-uuid', name: 'source-project', git_remote_url: 'https://github.com/x/y' }, { id: 'target-uuid', name: 'target-project', git_remote_url: 'https://github.com/x/y' }] }) })`

**The 6 tests:**

1. `test('State A — idle: trigger button visible with locked copy')`:
   - `await page.goto('/projects/source-project/settings')`
   - `await expect(page.getByRole('button', { name: 'Link to existing project' })).toBeVisible()` (locked copy from UI-SPEC line ~302)
   - `await expect(page.locator('[data-state="picker-open"]')).toBeHidden()`

2. `test('State B — picker open: candidates render with Matched badges')`:
   - Setup + click the trigger button
   - `await expect(page.getByRole('heading', { name: 'Suggested matches' })).toBeVisible()` (locked copy; per UI-SPEC.md the matched section is labeled this way)
   - `await expect(page.locator('[role="radio"]')).toHaveCount(1)` (the auto-match candidate — same git_remote_url)
   - `await expect(page.getByText('Matched')).toBeVisible()` (the badge)

3. `test('State C — type-to-confirm: submit disabled until name matches exactly')`:
   - Setup + click trigger + select the candidate + click Continue
   - `await expect(page.getByRole('button', { name: 'Link projects & delete source' })).toBeDisabled()` (locked copy from UI-SPEC line ~316)
   - `await page.getByLabel(/Type .* to confirm/).fill('source-projec')` (one char short)
   - `await expect(page.getByRole('button', { name: 'Link projects & delete source' })).toBeDisabled()`
   - `await page.getByLabel(/Type .* to confirm/).fill('source-project')` (exact match)
   - `await expect(page.getByRole('button', { name: 'Link projects & delete source' })).toBeEnabled()`

4. `test('State D — loading: spinner appears + button disabled during submit')`:
   - Setup with `route.fulfill` DELAYED (`setTimeout(() => route.fulfill(...), 2000)`)
   - Drive the form to State C with exact-match input
   - Click submit
   - `await expect(page.locator('.spinner-sm')).toBeVisible()` (spinner class from app.css per UI-SPEC)
   - `await expect(page.getByRole('button', { name: 'Link projects & delete source' })).toBeDisabled()`

5. `test('State E — success: success banner appears with locked copy + redirect to target')`:
   - Setup + drive to submit + wait for resolution
   - `await expect(page.getByRole('status')).toHaveText(/Linked .* to .*/)` (success copy from UI-SPEC; role="status" per a11y contract)
   - `await page.waitForURL('**/projects/target-project**', { timeout: 3000 })` (UI-SPEC says 1200ms redirect, allow margin)

6. `test('State F — error: 403 returns recovery copy with role=alert')`:
   - Setup with `route.fulfill({ status: 403, json: { error: 'NOT_OWNER', code: 'FORBIDDEN' } })`
   - Drive to submit
   - `await expect(page.getByRole('alert')).toBeVisible()`
   - `await expect(page.getByRole('alert')).toContainText(/You don't have permission/)` (recovery copy from UI-SPEC error class 1)
   - `await expect(page.getByLabel(/Type .* to confirm/)).toBeEnabled()` (form re-enabled for retry per UI-SPEC State F)

**Test discipline:**
- NO `test.only`, NO `test.skip` — every test runs
- NO snapshot tests — those are brittle and don't catch behavior
- NO sleeps — use Playwright's auto-waiting + `expect.toBe*()` matchers which retry until visible/enabled/etc.
- File is ~150-200 LOC total (small per-test setup blocks; shared mock helper if needed)
</action>

<verify>
<automated>cat frontend/e2e/projects-merge.spec.ts | grep -cE "^test\(" | grep -q "^6$" && echo "6 tests present" || echo "FAIL: expected 6 test() blocks"</automated>
</verify>

<acceptance_criteria>
- `frontend/e2e/projects-merge.spec.ts` exists
- File contains exactly 6 `test('State ...')` blocks (one per state A-F)
- File contains zero `test.only` or `test.skip` (`grep -E "test\.(only|skip)"` returns empty)
- File contains `page.route('**/api/projects/*/merge-into/*', ...` — backend IS mocked, NOT real
- File asserts the verbatim UI-SPEC copy strings: "Link to existing project", "Link projects & delete source", "Suggested matches", "Matched"
- File uses semantic locators (`getByRole`, `getByLabel`) — NOT raw CSS selectors for primary assertions (accessibility-first per UI-SPEC a11y contract)
- Tests cover all 6 states and the form re-enable on error (proves recovery copy isn't dead)
</acceptance_criteria>

<done>
Spec file written. Will fail locally on this machine (Playwright deps not installed via npm proxy block); will be verified in CI Task 3's verify step. Locked copy strings cited from UI-SPEC ensure regression coverage if anyone edits copy later.
</done>
</task>

<task type="auto">
<id>02-06-T3</id>
<name>Wire Playwright into CI's e2e job</name>
<read_first>
- .github/workflows/ci.yml (FULL current structure — the e2e job already exists with secrets scoped to `environment: prod`; we extend it, not duplicate)
- .github/workflows/publish.yml (avoid pattern conflict in case workflow_dispatch / push triggers overlap)
- .planning/phases/02-real-user-identity/02-RESEARCH.md (any deployment constraints — RESEARCH does NOT mention deploy infrastructure changes for Phase 2)
</read_first>

<action>
Edit `.github/workflows/ci.yml`. Inside the existing `e2e` job, between the `Build MCP CLI` step and the `E2E tests` step, add THREE new steps:

```yaml
      - name: Frontend env for e2e
        run: cp frontend/.env.example frontend/.env

      - name: Install Playwright browsers
        working-directory: frontend
        run: npx playwright install --with-deps chromium

      - name: Playwright e2e (UI)
        working-directory: frontend
        run: npx playwright test
        env:
          CI: "true"
```

After the existing `E2E tests` step (the one that runs `npx vitest run test/e2e/` in mcp), add a Playwright report upload step (runs even on failure for debugging):

```yaml
      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7
```

Do NOT touch the `verify` job. PR-time CI stays fast (no Playwright on PRs since this solo-dev project doesn't use PRs per memory `feedback_no_prs.md`; push-to-main on tanmain → bot mirror → CI runs on metanmai).

Do NOT touch the `publish.yml` workflow.
</action>

<verify>
<automated>grep -c "playwright install --with-deps chromium" .github/workflows/ci.yml | tr -d '[:space:]' | grep -q "^1$" && echo "Playwright install step present"; grep -c "npx playwright test" .github/workflows/ci.yml | tr -d '[:space:]' | grep -q "^1$" && echo "Playwright test step present"; grep -c "upload-artifact" .github/workflows/ci.yml | tr -d '[:space:]'</automated>
</verify>

<acceptance_criteria>
- `.github/workflows/ci.yml` `e2e` job contains a step running `npx playwright install --with-deps chromium`
- `.github/workflows/ci.yml` `e2e` job contains a step running `npx playwright test` in `working-directory: frontend`
- `.github/workflows/ci.yml` `verify` job is UNCHANGED (`git diff verify:` shows no modifications to the verify job's steps)
- `.github/workflows/ci.yml` includes `actions/upload-artifact@v4` for `playwright-report/` with `if: failure()` (debugging convenience, not gated)
- `.github/workflows/publish.yml` is UNCHANGED
- The new Playwright step inherits the existing `environment: prod` scoping (no additional secret declaration needed for the mocked tests)
</acceptance_criteria>

<done>
CI wired. Next push to main will trigger the e2e job which now installs Playwright + Chromium + runs frontend e2e tests. Failures upload an HTML report as a workflow artifact for post-hoc debugging.
</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
<id>02-06-T4</id>
<name>Local Playwright install on tethered network (one-time setup)</name>
<read_first>
- frontend/package.json (the new @playwright/test devDep from Task 1)
- frontend/playwright.config.ts (the config Task 1 wrote)
- frontend/e2e/projects-merge.spec.ts (the spec Task 2 wrote — will be RED until install)
- CLAUDE.md (proxy constraints)
- ~/.claude/projects/-Users-Tanmai-N-Documents-synapse/memory/feedback_npx_proxy.md (the proxy workaround)
</read_first>

<action>
**This task requires the operator (you, Tanmai) to act manually.** The Netskope corporate proxy blocks `npm install` on this machine, so Playwright cannot be installed via the standard `cd frontend && npm install` flow here.

**Operator steps (one-time, ~10 min on a tethered network):**

1. Tether the laptop to a non-corporate network (mobile hotspot OR home Wi-Fi):
   - Quick test: `cd frontend && npm view @playwright/test` — if this returns metadata, the network is fine; if it hangs or 502s, you're still on Netskope.

2. Install the dep:
   - `cd frontend && npm install` (installs all deps including the new @playwright/test)
   - Do NOT commit `frontend/package-lock.json` (per `feedback_no_lockfile.md`)

3. Install the Chromium browser binary:
   - `cd frontend && npx playwright install chromium`
   - This downloads ~150MB; needs the tethered network too

4. Run the spec locally to confirm green:
   - `cd frontend && npm run build && npm run test:e2e`
   - All 6 tests should pass on Chromium
   - If they fail: read the failure output, fix the spec OR the LinkPicker (whichever is wrong — Plan 02-05's manual smoke should have caught UI bugs, but Playwright catches behaviors human eyes miss)

5. Confirm `package-lock.json` is NOT staged for commit:
   - `git status` shows `frontend/package.json` modified (intentional) but NO `package-lock.json`
   - If lock file appears: `git checkout frontend/package-lock.json` to discard it (the lockfile is for proxy-bypass workflows, not for committing)

**Why this is a blocking checkpoint:**
- Without local install, Tasks 1-3 ship config + spec + CI wiring "by faith" — first proof of green is CI
- The CI install is also subject to npm registry availability; pre-validating locally rules out spec bugs vs CI infrastructure bugs
- The CI failure feedback loop is slow (~3-5 min per push); local feedback is fast (~30s per `npm run test:e2e` iteration)

**Skip-condition:** If the operator is okay with CI being the only validation surface (e.g., laptop tethering is impractical right now), this task can be skipped — Task 5's CI verification covers correctness. Skip cost: longer first-iteration loop if Task 2's spec has bugs. Document the skip in the SUMMARY.
</action>

<verify>
Operator-reported result. The auto-validator can spot-check that no package-lock.json was committed:
<automated>git log --name-only -1 | grep -c "package-lock.json" | tr -d '[:space:]' | grep -q "^0$" && echo "No lockfile committed (PASS)" || echo "FAIL: lockfile in latest commit"</automated>
</verify>

<acceptance_criteria>
- Operator confirms `cd frontend && npm install && npx playwright install chromium && npm run test:e2e` completed exit 0 on a tethered network (or skip-condition documented)
- `git status` shows no `frontend/package-lock.json` staged or committed
- Operator notes the test runtime locally (sanity check for CI budget — should be ~30-90s)
</acceptance_criteria>

<done>
Playwright works locally OR skip-condition is acknowledged. If skipped, Task 5 carries full validation burden.
</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
<id>02-06-T5</id>
<name>Push and verify CI's e2e job goes green with Playwright passing</name>
<read_first>
- .github/workflows/ci.yml (post-Task-3 — the e2e job's new Playwright steps)
- The commit history for this plan (`git log --oneline`)
- The metanmai/synapse Actions tab in GitHub (where CI actually runs — bot mirrors tanmain → metanmai)
</read_first>

<action>
**Operator steps:**

1. Push all Plan 02-06 commits to tanmain/synapse main:
   - `git push origin main`
   - Pre-push hook (lint + typecheck + test) runs ~25s; if it fails, fix and re-push

2. Wait for the bot to mirror tanmain → metanmai (typically <60s; per memory `project_git_sync.md`)

3. Open the metanmai/synapse Actions tab (or run `gh run list --repo metanmai/synapse --limit 5` from a gh-authenticated terminal)

4. Watch the `verify` job complete first (~3 min) — must be green before `e2e` job starts (per `needs: verify` in ci.yml)

5. Watch the `e2e` job:
   - "Install dependencies" step (npm install at root) — should pass; this is the first time the new @playwright/test dep is resolved on a fresh node_modules
   - "Build MCP CLI" — unchanged behavior
   - "Frontend env for e2e" — copies frontend/.env.example to frontend/.env
   - **"Install Playwright browsers" — NEW; downloads Chromium + apt-get installs system deps (~60s)**
   - **"Playwright e2e (UI)" — NEW; builds frontend, starts preview server, runs spec against Chromium (~60-90s for 6 tests)**
   - "E2E tests" (mcp/test/e2e/ — unchanged) — should still pass

6. **If the e2e job fails:**
   - Download the `playwright-report` artifact (the `if: failure()` step uploaded it)
   - Open `playwright-report/index.html` in a browser — Playwright's HTML reporter shows trace + screenshot + failure stack per failed test
   - Diagnose: is it a spec bug, a UI bug, an infrastructure bug (Chromium download failed, port conflict)?
   - Fix and re-push

7. **If green:** confirm in this task's verify field. Mark plan done.

**Acceptable failure modes that should NOT block (note them in SUMMARY):**
- One transient flake on a single test (retry built into Playwright config) — accept if subsequent runs are green
- Slow first-run (downloads + cold build) approaching the 10-min `e2e` job timeout — increase timeout to 15 min if needed; not a Playwright bug
</action>

<verify>
Operator-reported result. Auto-validator confirms the workflow file is what we expect:
<automated>grep -E "playwright install|playwright test" .github/workflows/ci.yml | head -3</automated>
</verify>

<acceptance_criteria>
- Operator confirms metanmai/synapse latest CI run shows `e2e` job GREEN
- Playwright HTML report from the run shows all 6 tests passing on Chromium (visible in CI logs or via downloaded artifact if any retry-passed)
- `verify` job is unaffected — its runtime hasn't grown (PR-time CI stays fast)
- Operator notes the e2e job runtime (sanity check against 10-min timeout budget)
</acceptance_criteria>

<done>
Phase 2 has automated browser-driven UI regression coverage that runs on every push to main. The IDENT-02 manual-link UI is now protected against future regressions by Playwright in addition to the manual UI smoke in Plan 02-05.
</done>
</task>

</tasks>

<verification>
## Plan Verification

Before marking this plan COMPLETE in SUMMARY.md, verify:

1. `frontend/package.json` declares `@playwright/test` as devDep and has `test:e2e` script — `grep -E "@playwright/test|test:e2e" frontend/package.json`
2. `frontend/playwright.config.ts` exists with Chromium-only project and webServer block — `cat frontend/playwright.config.ts | grep -E "chromium|webServer"`
3. `frontend/e2e/projects-merge.spec.ts` exists with exactly 6 `test()` blocks covering states A-F — `grep -c "^test\(" frontend/e2e/projects-merge.spec.ts`
4. `.github/workflows/ci.yml` `e2e` job contains Playwright install + run steps — `grep -E "playwright install|playwright test" .github/workflows/ci.yml`
5. `.github/workflows/ci.yml` `verify` job is unchanged — `git diff origin/main -- .github/workflows/ci.yml | grep -A 30 "verify:" | head -40`
6. No `package-lock.json` committed in any of this plan's commits — `git log --since="this plan" --name-only | grep -c "package-lock.json"` returns `0`
7. CI's latest run on metanmai/synapse shows the `e2e` job green with Playwright passing — manual confirmation per Task 5

## Goal-Backward Check

This plan delivers: **automated browser-driven UI regression coverage for the IDENT-02 manual-link surface**. It does NOT deliver: new product behavior, new schema changes, new endpoints. It is a test-infrastructure plan that complements Plans 02-01 (unit RED scaffolding) and 02-05 (manual UI smoke) by adding the missing third tier of test fidelity (real browser, real DOM, real interactions).

If you can answer YES to all 7 verification items above, this plan is COMPLETE.

</verification>

<threat_model>
This plan adds a dev-only test dependency (`@playwright/test`) and CI workflow steps. No production behavior changes. No security-relevant code modified.

| Threat | Severity | Mitigation |
|--------|----------|-----------|
| Supply-chain risk via @playwright/test transitive deps | LOW | Microsoft-maintained package, widely audited, large user base. Standard `npm install` audit applies. |
| CI secret exposure via Playwright artifacts | LOW | The `if: failure()` artifact uploads only the HTML report from `playwright-report/`. Mocked tests never see real secrets. Existing `environment: prod` scoping limits secret visibility to this job. |
| Test backend interference | NONE | Backend is mocked via `page.route()` — no test backend touched by this plan's tests. The existing `npx vitest run test/e2e/` step (using real Supabase) is unaffected. |

No `<threat_refs>` declared in frontmatter — this plan does not mitigate any phase-level threats (T-02-XX). Those remain the responsibility of Plans 02-01..02-05.
</threat_model>

<out_of_scope>
**Explicitly NOT in this plan:**

- **Cross-browser testing** — Firefox and WebKit are NOT installed/tested. Chromium covers Chrome/Edge/Brave/Electron. Cross-browser coverage is a future concern (Phase 3+) if user reports surface browser-specific bugs.
- **Visual regression / screenshot diffing** — Playwright's `toHaveScreenshot()` is not used. Reasons: snapshot tests are flaky across OS / font-rendering / antialiasing; the manual UI smoke in Plan 02-05 catches visual issues human eyes care about; locked copy strings + semantic locators catch behavior changes Playwright should catch.
- **Real backend integration testing** — All API calls are mocked via `page.route()`. The real merge endpoint + RLS + SQL function are covered by Plan 02-05's manual UI smoke against dogfood Supabase. A "full-stack Playwright" tier was considered and explicitly deferred (per the user's decision when this plan was scoped).
- **Performance / accessibility audit (Lighthouse, axe-core)** — Not included. axe-core integration is straightforward (`@axe-core/playwright`) and is a candidate for a future Phase 3 telemetry plan. UI-SPEC's a11y contract is already covered by semantic-locator assertions in Task 2.
- **PR-time Playwright (in `verify` job)** — Not included. Solo-dev workflow has no PRs (per memory `feedback_no_prs.md`); push-to-main IS the only path; the existing `e2e` job's push-to-main gating matches our risk profile.
- **Frontend deps proxy fix** — Not in this plan's scope. The "tether to install" workaround is documented in CLAUDE.md + memory; a permanent fix (Verdaccio mirror, internal npm proxy, corporate IT exception) is a separate operations concern.
- **Dropping the manual UI smoke task in Plan 02-05** — Manual smoke catches things Playwright can't (visual hierarchy, perceived performance, brand feel). Both tiers stay. Playwright is regression coverage; manual smoke is first-impression coverage.
</out_of_scope>
