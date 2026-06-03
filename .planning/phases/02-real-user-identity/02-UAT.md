---
status: testing
phase: 02-real-user-identity
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 02-03-SUMMARY.md
  - 02-04-SUMMARY.md
  - 02-05-SUMMARY.md
  - 02-06-SUMMARY.md
started: 2026-05-21T03:00:00Z
updated: 2026-05-21T03:00:00Z
scope: local-testable
deferred:
  - "Cross-device auto-link by git_remote_url end-to-end (needs supabase db push + wrangler deploy)"
  - "Manual link merge via deployed Settings page (needs backend route deployed + frontend redeploy)"
  - "Playwright e2e green in CI on metanmai/synapse (needs first CI run with Playwright steps)"
---

## Current Test

number: 3
name: Daemon emits real UUID, not "default" placeholder
expected: |
  Inspect a recent event: `tail -5 ~/.synapse/projects/<any-project-id>/events.jsonl | jq .actor`. Every event's `actor.user_id` should match the UUID in `~/.synapse/config.json`. Zero events with `actor.user_id == "default"`.
awaiting: user response

## Tests

### 1. Cold-Start Smoke Test
expected: |
  Kill the daemon → restart → status reports running, log shows no errors, first flush succeeds with real user_id (not "default"). This catches regressions in startup sequencing, identity bootstrap, and the flush pipeline together.
result: skipped
reason: user signaled "go ahead for now" — deferred to a later local pass

### 2. synapse init persists real user_id + email (IDENT-01)
expected: |
  Run `synapse init <api-key>` (use your existing API key). After it completes, `cat ~/.synapse/config.json` shows three fields: `api_key`, `user_id` (UUID matching your `public.users` row), and `email`. No `"default"` placeholder anywhere.

  If config.json already has the fields from a prior init, re-running is idempotent — the values stay stable and the file isn't rewritten with `"default"`.
result: pass
reported: "Right now what I do is npm run build in the mcp folder and it just works"
note: user passed on the strength of their working local dev loop; strict config.json shape verification not explicitly confirmed

### 3. Daemon emits real UUID, not "default" placeholder
expected: |
  After Test 1 + 2, trigger a daemon flush (either wait for the natural ~5-min cycle OR `synapse capture flush` if that exists, OR just generate a Claude Code SessionStart in any project). Then inspect the most recent events: `tail -5 ~/.synapse/projects/<any-project-id>/events.jsonl | jq .actor`. Every event's `actor.user_id` should match the UUID in `~/.synapse/config.json`. Zero events with `actor.user_id == "default"`.
result: [pending]

### 4. Device-origin brief renderer (D-09)
expected: |
  The cleanest way to verify the renderer locally without a second machine: run the vitest test that exercises it.
  ```
  cd mcp && npx vitest run test/capture/handoff-brief.test.ts -t "same-user different-device"
  ```
  Expected: the test passes (1 test) and stdout shows the assertion ".toContain('on " + hostname + "')". If you want to eyeball the rendered output, add `console.log(rendered)` inside the test temporarily and re-run — the brief should include "(on <hostname>)" in the "Your last activity" line.
result: [pending]

### 5. LinkPicker UI states A → B → C → D → E render correctly
expected: |
  Boot the frontend dev server: `cd frontend && npm run dev`. Open `http://localhost:5173/__e2e/link-picker?scenario=basic`. Walk through:
  - State A: "Linked Projects" heading visible + "+ Link to existing project" button enabled.
  - Click trigger → State B: "Your other projects" heading + 1 radio for "target-project" + "Cancel" + "Continue" (disabled).
  - Pick the radio → "Continue" becomes enabled → click it.
  - State C: prompt "This is irreversible. Type the source project name to confirm." + subtext interpolating "source-project" + "target-project" + "Link projects & delete source" button (disabled).
  - Type "source-project" exactly → button enables.
  - Click submit → State D: spinner + "Linking…" briefly (action returns quickly in default scenario).
  - State E: redirects to `/__e2e/link-picker?landed=1`; trigger button visible again.
result: [pending]

### 6. LinkPicker error State F renders locked copy (403)
expected: |
  Navigate to `http://localhost:5173/__e2e/link-picker?scenario=basic&next=403`. Walk the same flow as Test 5 (trigger → pick → confirm → submit). After submit, expect:
  - URL stays on the picker (no redirect)
  - A `role="alert"` banner appears with the verbatim UI-SPEC §State F copy: "You're not the owner of one of these projects. Only the owner can link projects."
  - The submit button re-enables for retry (after the form action settled)
result: [pending]

### 7. Full test suite stays green across all 4 workspaces
expected: |
  From the repo root: `npm test`. All workspaces exit 0:
  - backend: 380 passing, 20 skipped, 0 failing
  - packages/shared: 72 passing
  - frontend: 72 passing (vitest only — Playwright is CI-gated, doesn't run here)
  - mcp: 372 passing, 164 skipped, 0 failing

  This is the regression guard: every RED test from Wave 0 (Plan 02-01) flipped GREEN, and no Phase 1 tests regressed.
result: [pending]

## Summary

total: 7
passed: 1
issues: 0
pending: 5
skipped: 1
blocked: 0

## Gaps

<!-- Phase 2 itself: no functional gaps. State F alert renders correctly on prod (Playwright fixture-route failure is a test-only artifact). The deferred operator action (apply merge_projects SQL function) is the only thing blocking the happy-path success. -->

## Out-of-Scope Findings (UX, addressed inline)

Found while clicking around prod for the UAT. NOT Phase 2 regressions — pre-existing UX issues fixed in the same window because the cost was trivial.

- **fixed:** AppShell topbar showed "Select workspace ▼" / "My Workspaces" dropdown on the home page itself, duplicating the project picker that IS the home page. Fix: hide the entire switcher when `currentProject` is null (i.e., when not inside a `/projects/<name>/*` route). On `/home`, the cards are now the single project surface; the switcher only appears inside projects, where it's actually useful for fast cross-project jumps. Also renamed the dropdown group label "My Workspaces" → "My Projects" to align with the DB/API terminology (`projects` table).
- **fixed:** "Projects: N / 50" rendered as its own div at the bottom of the home page. Fix: moved to a subtle pill next to the "Your Projects" heading; bottom usage-bar removed entirely. For free-tier users, the pill is clickable (→ /account) with hover tooltip ("Free tier supports up to N projects. Upgrade to Plus for 50."). For paid users, the pill is static with the same tooltip format minus the upgrade prompt.

## Production E2E Findings (Plan 02-05)

- **confirmed working on prod:** Frontend deployed. LinkPicker visible on `/projects/<name>/settings`. State B picker opens, State C type-to-confirm gate engages with both project names interpolated correctly. Submit reaches the backend (5xx returned, not 404), confirming the backend route is deployed too. State F 5xx alert renders the verbatim UI-SPEC §State F locked copy.
- **deferred (operator action):** the `merge_projects` SQL function isn't applied to dogfood Supabase yet. Submit currently 5xx's because the RPC call fails at Postgres. Apply via Supabase Dashboard SQL Editor or `supabase db push` to unlock the happy path.
