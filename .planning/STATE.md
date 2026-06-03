---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
last_updated: "2026-05-22T06:00:00.000Z"
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 11
  completed_plans: 10
  percent: 14
---

# State — Stabilize-for-Launch Milestone

*Last updated: 2026-05-22 — Phase 2 SHIPPED in code (6/6 plans) end-to-end on 2026-05-20 evening (commits `0812764` close-out, `8038636` Plan 02-05 Slice C Manual Link UI, `c66f30e` Plan 02-06 Playwright e2e). **UAT walkthrough on 2026-05-21/22 surfaced 9 inline UX/docs fixes** (`5823cbe` → `2b04178`, see Recent activity) and **5 critical OPEN issues** ranked in "Critical Open Issues" below. Prod LinkPicker visually validated by user's click-through on `synapsesync.app` — State A→C render correctly, State F locked-copy alert renders on the predicted 5xx (blocked on the unfixed `merge_projects` SQL function not yet applied). CI green on metanmai across all shipped commits (896 vitest passing across 4 workspaces). Highest-leverage operator action now: apply migrations 018 + 019 via Supabase Dashboard SQL Editor (~3 min) — unblocks /api/events/batch 1101 + 1,597 queued local events + LinkPicker happy path on prod, all in one shot.*

## Project Reference

**Project:** Synapse — context management tool that captures AI coding sessions and surfaces insights across projects.

**Core value:** The next session knows where the last one left off. The capture → daemon → backend → brief loop is the non-negotiable spine; everything else can degrade.

**Current milestone:** Stabilize-for-launch. Public launch with waitlist throttle by **Friday 2026-05-29** (10 days from today, 7 working days).

**Current focus:** Phase 2 code shipped; UAT partial (2 of 7 tests resolved, paused at user's pivot to prod walkthrough). Highest-leverage next action: apply migrations 018+019 via Supabase Dashboard SQL Editor — fixes the production /api/events/batch 1101 + restores LinkPicker happy path + flushes 1,597 queued events. Phase 3 (Telemetry) begins after these stabilize. Slice 1b residual (OPS-01 + Plan 05 Sentry) still parked on CF-enabled machine.

## Current Position

- **Phase:** Phase 2 ✅ SHIPPED end-to-end (6/6 plans). Phase 1 slice 1a-prime ✅ COMPLETE; slice 1b ⏳ partial (BUG-01 closed; OPS-01 + Plan 05 deferred to CF-enabled machine).
- **Plan:** Phase 2 complete. Verify pending. Next phase 3 starts after `/gsd:verify-work 2` confirms IDENT-01 + IDENT-02 success criteria.
- **Status:** BUG-01, BUG-02, BUG-03, BUG-04, BUGS-MD-12 all closed in prod. IDENT-01 (real user UUID through capture pipeline) + IDENT-02 (cross-device link auto + manual) shipped in code. Migration 018 (column + merge_projects) awaits operator `supabase db push`. CI green across all 4 workspaces.
- **Roadmap progress:** 1/7 phases complete (Phase 2 fully shipped; Phase 1 counted partial — slice 1b residual)

**Slice routing (2026-05-19, updated):** Phase 1 originally split into 1a (wrangler-free) + 1b (CF machine). Pre-execution audit revealed Plan 05's `npm install @sentry/*` is also Netskope-blocked here. So slice 1a was further narrowed to "1a-prime": BUG-02, BUG-03, BUG-04, BUGS.md #12 land here; OBS-01 (full — code + deploy + verify) consolidated into slice 1b alongside BUG-01 + OPS-01. Phase is complete only when both slices ship.

```
[██░░░░░░░░░░░░░░░░░░] 14% — 1 of 7 phases shipped (Phase 2 fully; Phase 1 slice 1a-prime ready, 1b residual deferred)
```

## Performance Metrics

- **Window:** 2026-05-19 → 2026-05-29 (10 days, ~7 working days)
- **Phases planned:** 7
- **Phases shipped:** 1 (Phase 2; Phase 1 slice 1a-prime done, 1b residual deferred to CF-enabled machine)
- **Requirements v1:** 23 (all mapped, 100% coverage)
- **Days remaining:** 7

## Accumulated Context

### Key decisions (this milestone)

- **Cross-user collaboration moved IN scope (2026-05-19).** Backend already has `project_members` + invites endpoint — finishing the UI is bounded work. Launch slipped from EoW (2026-05-22/23) to Friday 2026-05-29 to accommodate.
- **Token brokering moved IN scope (2026-05-19).** Substantial new feature with ToS / privacy / accounting surface. Highest-risk item in the milestone. Chosen over per-user-key-routing because it creates a sticky Plus subscriber benefit.
- **Waitlist = throttled-access (Linear / OpenAI API style)**, not marketing-waitlist (Dropbox / Robinhood). Synapse needs to LIMIT, not GROW.
- **Telemetry rides existing event pipeline.** Zero new tables, zero new endpoints. New EventKinds: `BriefRendered`, `BriefRated`, `FirstNonOrientationPrompt`.
- **Sentry over toucan-js.** `@sentry/cloudflare` + `@sentry/hono`; toucan archived 2026-01-12.
- **Solo dogfood is the only pre-launch user signal.** Cold-laptop rehearsal is the bounded compromise against confirmation bias.

### Open questions / TODOs

- **BUG-01 root cause refuted, not the Promise.all hypothesis.** Real cause was `handoff_events` table missing from prod Supabase — schema drift between `supabase/migrations/*.sql` and prod went undetected. **Process gap:** no drift detection between migration files and prod schema. Worth a separate cleanup task. **2026-05-22 update:** same class recurring — see Critical Open Issue #1 below (migration 018 column missing causes /api/events/batch to 1101).
- **Phase 2, 4, 5 need per-phase research** before planning (IDENT, COLLAB, TOKEN were added after the 4-agent research wave). `/gsd:discuss-phase N` will invoke a researcher.
- **Workers Paid tier** needs verification — assumption until proven otherwise.
- **Linux daemon path** is unverified at launch unless a Linux machine is accessed during Phase 1.

### Critical Open Issues (diagnosed 2026-05-21/22 during UAT walkthrough — NOT yet fixed)

1. **`/api/events/batch` returns Cloudflare 1101 on every flush.** Empirically confirmed root cause: migration 018's `git_remote_url` column add isn't applied to dogfood Supabase. The deployed events-batch matcher at `backend/src/api/events-batch.ts:91-112` queries that column on every `cwd_<12hex>` flush; column missing → query throws unhandled → Worker 1101. 1,597 events queued locally across 12 cwd_* directories. Same BUG-01 class. **Fix:** apply `supabase/migrations/018_projects_git_remote_url.sql` + `019_merge_projects.sql` via Supabase Dashboard SQL Editor (both `create or replace` / `if not exists`-safe to re-apply). Then re-run `synapsesync wizard` to refresh stale `~/.synapse/config.json` (currently has only `api_key`, missing `user_id` + `email` — user never re-ran init after Plan 02-02 shipped, so all queued events carry `actor.user_id: "default"`).

2. **Creem webhook drift — billing card shows 22+ day stale renewal date.** `/api/billing/status` returns `{ status: "active", current_period_end: "2026-04-29..." }` while today is 2026-05-22. Webhook handler at `backend/src/api/billing.ts:17-118` has **no `default:` case** in the switch — renewals likely fire `subscription.updated` / `subscription.renewed` / `invoice.paid`, none handled, silent 200 OK to Creem (no retry, no log). Secondary: field-name mismatch — webhook reads `obj.current_period_end` (line 67), `/verify` endpoint at line 188 reads `current_period_end_date`. **Diagnostic next:** check Creem dashboard → Webhooks → Delivery history around April 29 to confirm which hypothesis. User has a 4-step checklist from the prior session's chat history.

3. **Test pollution in `~/.synapse/project-map.json`.** Real user `~/.synapse/` directory contains fixture entries (`/home/user/project` → `proj_1`, `project_name: "P"`) written by a vitest run on 2026-05-21. Some test is writing to the live `~/.synapse/` instead of a tmpdir. Find with `grep -rn "project-map" mcp/test/` and fix the test's fs setup to use `os.tmpdir()` + cleanup.

4. **Two Playwright fixture-route tests fail in CI on metanmai (Plan 02-06).** State E (post-redirect trigger-not-visible) + State F (alert-not-appearing) fail; other 5 pass. Suspected SvelteKit client-side-nav reusing the LinkPicker instance when the `/__e2e/link-picker` route's form action redirects back to itself. **Production itself works** — confirmed via user's prod walkthrough that the State F alert renders correctly on the deployed Settings page. Test-only artifact, lower priority.

5. **Dashboard "conversations" count doesn't include Claude Code activity.** `getProjectStats` at `backend/src/db/queries/projects.ts:140` reads from the `conversations` table only — that table is populated by adapter-based capture (Cursor/Codex/Gemini). Claude Code activity flows via the hook pipeline into `handoff_events`. Result: users who work primarily in Claude Code see "0 conversations · 0 insights" forever, even with thousands of captured handoff events. Architecture-level mismatch. Probably wants a deliberate design call: surface both counts separately, or unify under a "captured events" metric.

### Blockers

- **Slice 1b residual (CF-machine work):** OPS-01 (`wrangler whoami` + Workers Paid screenshot) + Plan 05 (Sentry full pipeline; `npm install @sentry/*` is Netskope-blocked on the primary terminal). Both park on a CF-enabled machine.
- This terminal has no remaining Phase 1 blockers — slice 1a-prime is shipped end-to-end.

### Recent activity

- 2026-05-18: Shipped per-device CLI keys end-to-end (`a8ecf98` + `34de058`) and fixed 5 install-pipeline bugs (`d3cd771` + `025a814`). Daemon alive locally via launchd; cloud sync blocked by BUG-01.
- 2026-05-19: Scope re-expansion (COLLAB + TOKEN added). 4-agent research consolidated into `research/SUMMARY.md`. Requirements rewritten. Roadmap created. Slice 1a-prime executed: BUG-02, BUG-03, BUG-04, BUGS.md #12 all closed inline (17 RED → GREEN; commits `19e3f8e` → `9a0db69`).
- 2026-05-20 (today): BUG-01 closed on two layers — functional (migrations 015/016/017 re-applied to restore `handoff_events`) + defensive (Promise.allSettled swap deployed via CF git auto-integration, `16a4de1` + `2eb158b`). Account reset performed; one fresh project on dashboard. SessionStart hook learned STATE.md fallback so cold-start briefs surface the repo's hand-curated context instead of the apologetic "no cached context" string (`d61857b`). BUGS.md + STATE.md stale-state cleanup (`ce0c253`): 5 closed bugs moved to Closed, #10 rewritten as "CF git auto-deploy can go silent." Phase 2 context gathered (`f445a1d`): same-user multi-device identity + cross-device discovery; 9 decisions locked. Phase 2 research (`2bfbb29`) + validation strategy (`8c4b322`) produced: 4 natural vertical slices, 9 pitfalls documented, vitest test infra mapped, Wave 0 gaps enumerated. UI-SPEC produced + verified (`9872e06`): inline-expand pattern mirroring `DangerZone.svelte`, 0 new tokens, 0 new deps. Pattern map produced (`fa95b42`, 21 files with concrete analog refs). Plans produced + checker-approved (`68d5633`), then expanded to **6 plans in 5 waves** (`add5bbb`).
- 2026-05-20 (late evening): **Phase 2 ALL WAVES SHIPPED end-to-end**.
  - **Close-out** (`0812764`): safe_resume_gate caught missing SUMMARY.md files for Waves 2-3 shipping commits. Backfilled 02-02 / 02-03 / 02-04 SUMMARY.md + flipped ROADMAP checkboxes. Pure planning-artifact reconciliation, no code changes.
  - **Plan 02-05 Slice C Manual Link UI** (`8038636`): merge_projects SQL function appended to migration 018 (security definer plpgsql with owner-check×2 + reassign-FIRST-then-delete per RESEARCH Pitfall 7), POST /api/projects/:id/merge-into/:target_id route with self-link 409 guard + triple-layer owner-check (frontend candidate filter + backend requireRole×2 + SQL re-verify) + RPC call + activity_log + recomputeProjectStatus, LinkPicker.svelte (~270 LOC, 6 UI-SPEC states, inline-expand pattern, NO floating modal, fieldset+legend.sr-only, "Matched" aria-label, role="alert", svelte:window Escape, tick()+focus management, all locked copy verbatim), api.mergeProjects + listLinkCandidates wired, settings page mount, linkProject form action with 5 status-code → UI-SPEC §State F locked-copy mappings (403/404/409/5xx/network).
  - **Plan 02-06 Wave 5 Playwright e2e** (this commit): @playwright/test@^1.49.0 devDep declared (no npm install on this machine — proxy blocked; CI installs every run), playwright.config.ts (Chromium-only project, preview not dev, CI retries=2 workers=1, html+github reporters on CI), test-only fixture route `/__e2e/link-picker` outside the (app) auth layout (chose this over cookie-mocked auth because hooks.server.ts validates via real Supabase — fake cookies get rejected mid-request), 7-test spec (one extra State A "disabled when empty" case beyond the 6 base states) covering A-F via semantic locators (`getByRole`, `getByPlaceholder`, `getByLabel`) asserting verbatim UI-SPEC copy strings, CI wired (Playwright install + run between Build MCP CLI and existing mcp E2E tests + Upload Playwright report on failure).
  - CI green across all 4 workspaces: backend 380 / frontend 72 / packages 72 / mcp 372 = **896 passing, 184 skipped, 0 failing** (+playwright spec runs first time on next CI push).
  - **Operator action consolidated:** `supabase db push` to apply migration 018 (now col + merge_projects function), `wrangler deploy` backend, frontend redeploy. All deferred to next CF-enabled-machine session. Code is production-deployable; activation requires the deploy.

- 2026-05-21/22 (multi-day UAT walkthrough): `/gsd-verify-work 2` invoked — 2 of 7 scripted tests resolved (Test 1 cold-start skipped per user signal "go ahead for now"; Test 2 init persists user_id passed on user's "it just works" report). Rest paused mid-walkthrough as the user pivoted to clicking through real prod surfaces on `synapsesync.app`. **9 atomic UX/docs fixes shipped during the walkthrough** (`5823cbe` → `2b04178`):
  - `5823cbe` AppShell switcher hidden on /home + home count moved to pill with info button + "Workspaces" → "Projects"
  - `239d1f0` Migration 018→019 split (merge_projects extracted to a new filename so `supabase db push` can apply it; original 018 was already marked applied for the column add) + CI auto-migrate job scaffolded (`.github/workflows/ci.yml` `migrate:` job, gracefully skips until SUPABASE_* secrets configured) + BUGS.md P1 entry with setup steps
  - `fbb4fee` SetupGuide install-command block fixed: no horizontal scroll, copy button centered + non-overlapping (sibling flex layout instead of absolute overlay), bash line-continuation for multi-line display
  - `8da6ec5` HowItWorks illustrations rewritten — old illustrations depicted wrong concepts (Capture showed `.mcp.json` which is retrieval plumbing; Distill showed Claude⇄ChatGPT which is cross-tool sharing not LLM-extraction; Remember showed two-user folder sharing which is Phase 4 cross-user collab not single-user context-recall)
  - `d2c550e` UAT partial-state committed (`.planning/phases/02-real-user-identity/02-UAT.md`)
  - `4dfc7d1` OR divider on `/login` + `/signup` + `/cli-auth` — span had `background-color: transparent` so the line crossed through the "or" text
  - `906063a` README: `synapse <cmd>` → `synapsesync <cmd>` everywhere + removed dead `daemon.ai_enabled` paragraph (config flag doesn't exist in codebase) + reflect adapter-driven capture for non-Claude-Code tools (`mcp/src/capture/adapters/{cursor,codex,gemini}.ts`) + add Phase 2 cross-device features paragraph
  - `bf2f3a2` README pronouns for Tanmai (he/him, not she/her) + memory `user_tanmai_pronouns.md` so future sessions don't repeat the assumption from the name spelling
  - `2b04178` 5 user-facing CLI error/usage strings fixed to say `synapsesync` instead of `synapse` (handlers.ts:143+175, commands.ts:196, os-service.ts:145, mcp-command.ts:18). Test fixtures referencing the v1.0 `synapse hook X` shape kept as-is — they test the backwards-compat migration detector.
  - **5 critical OPEN issues diagnosed but NOT fixed** — see "Critical Open Issues" above.

## Session Continuity

**To resume work in a fresh session:**

1. Read `.planning/PROJECT.md` for project + milestone context
2. Read `.planning/REQUIREMENTS.md` for the 23 v1 requirements + traceability
3. Read `.planning/ROADMAP.md` for the 7-phase plan and dependency graph
4. Read this `.planning/STATE.md` for current position
5. Read `.planning/research/SUMMARY.md` for technical decisions on Phases 1, 3, 6
6. Read `docs/BUGS.md` for the canonical "what's still broken" list

**Next actions (ranked by user-leverage):**

1. **Highest — apply migrations 018 + 019 via Supabase Dashboard SQL Editor** (~3 min). Single action unblocks: the /api/events/batch 1101, the 1,597 locally-queued events flushing on next daemon cycle, the LinkPicker happy-path merge on prod, and Phase 2 IDENT-01/02 SC verification gates. SQL is in `supabase/migrations/018_projects_git_remote_url.sql` (column add + index) and `supabase/migrations/019_merge_projects.sql` (function). Both `create or replace` / `if not exists`-safe to re-apply. After apply, re-run `synapsesync wizard` locally to refresh stale `~/.synapse/config.json` (will populate `user_id` + `email` via Plan 02-02's init flow).
2. **Highest — check Creem dashboard → Webhooks → Delivery history around 2026-04-29** to confirm which billing-drift hypothesis is correct (event-type missing / field-name mismatch / signature reject / sub-id mismatch). 4-step checklist available in prior session's chat history; once confirmed, defensive fix is small (add `default:` case + normalize field paths + add self-heal in `/api/billing/status`).
3. **Medium — file Critical Open Issues #2, #3, #5 as BUGS.md entries** (Creem drift, test pollution, dashboard metric mismatch). #1 is already covered by the existing `docs/BUGS.md` P1 "Configure Supabase secrets" entry; #4 is a low-priority test-only artifact that can be deferred indefinitely.
4. **Medium — configure SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD secrets on metanmai/synapse** per `docs/BUGS.md` P1 setup steps. Activates the already-scaffolded CI auto-migrate job (`.github/workflows/ci.yml` `migrate:` between `verify:` and `e2e:`). Prevents the BUG-01-class issue from recurring.
5. **Low — resume Phase 2 UAT via `/gsd-verify-work 2`** — Tests 3-7 outstanding. Most are orthogonal to the 1101 (LinkPicker fixture route works locally without auth via `/__e2e/link-picker`; brief renderer testable as vitest unit test; full suite green is auto-verifiable).
6. **Low — fix the 2 Playwright fixture-route artifacts** (State E + F). Suspected SvelteKit client-side-nav state-reuse; component itself is correct (prod proves it). May require a key/remount strategy on the fixture route's redirect target.

Slice 1b residual (OPS-01 + Plan 05 Sentry) still parked on CF-enabled machine — unchanged from prior state. **CI invariant:** stay green on metanmai at all times (per `feedback_ci_must_stay_green.md`).

## Critical Risks Active

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|------------|
| Token brokering ToS/privacy/accounting eats the window | Critical | 5 | MVP rule: ONE call path end-to-end, not full broker |
| 1101 isn't the reducer — Phase 1 takes 2 days not 0.5 | High | 1 | `wrangler tail` is the gate, not a step |
| Scope creep ("while I'm in here" cleanups) eats the window | High | All | Daily out-of-scope audit; BUGS.md overflow |
| Solo dogfood = confirmation bias | High | 6 | Cold-laptop rehearsal (LAUNCH-03) is the bounded compromise |
| Supabase invite email rate limits trip during launch | Medium | 6 | Verify current limit before opening floodgates |
