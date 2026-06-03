---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
last_updated: "2026-05-20T18:10:00.000Z"
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 11
  completed_plans: 10
  percent: 14
---

# State — Stabilize-for-Launch Milestone

*Last updated: 2026-05-20 (late evening) — **Phase 2 ALL WAVES SHIPPED**. Close-out commit `0812764` backfilled SUMMARY.md for Plans 02-02/03/04 (production commits existed but SUMMARY.md ritual was skipped — caught by safe_resume_gate). Plan 02-05 (Slice C Manual Link UI, Wave 4) shipped via `8038636`: merge_projects SQL RPC appended to migration 018, POST /api/projects/:id/merge-into/:target_id route with triple-layer owner-check (frontend filter + backend requireRole×2 + SQL re-verify), LinkPicker.svelte with all 6 UI-SPEC states + locked copy + accessibility contract (section landmark, fieldset+legend.sr-only, Matched aria-label, role="alert", svelte:window Escape, tick()+focus management), api.mergeProjects + listLinkCandidates wired, settings page mount + linkProject form action with 5 status→locked-copy mappings. Plan 02-06 (Wave 5 Playwright e2e) shipped via this commit: @playwright/test devDep declared, playwright.config.ts (Chromium-only, preview not dev), test-only fixture route /__e2e/link-picker (sidesteps Supabase-auth-via-hooks.server.ts), 7-test spec covering states A-F with semantic locators + verbatim UI-SPEC copy assertions, CI wired (install + run + report-on-failure upload). **CI GREEN: 380+72+372=824 vitest passing, 184 skipped, 0 failing.** Phase 2 closes IDENT-01 + IDENT-02. Operator action consolidated: supabase db push migration 018 (now col + merge_projects function), wrangler deploy, frontend redeploy*

## Project Reference

**Project:** Synapse — context management tool that captures AI coding sessions and surfaces insights across projects.

**Core value:** The next session knows where the last one left off. The capture → daemon → backend → brief loop is the non-negotiable spine; everything else can degrade.

**Current milestone:** Stabilize-for-launch. Public launch with waitlist throttle by **Friday 2026-05-29** (10 days from today, 7 working days).

**Current focus:** Phase 2 SHIPPED. Next: `/gsd:verify-work 2` for phase-level UAT, then begin Phase 3 (Telemetry — Quality & Speed Signals). Slice 1b residual (OPS-01 + Plan 05 Sentry) still parked on CF-enabled machine.

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
- **Days remaining:** 9

## Accumulated Context

### Key decisions (this milestone)

- **Cross-user collaboration moved IN scope (2026-05-19).** Backend already has `project_members` + invites endpoint — finishing the UI is bounded work. Launch slipped from EoW (2026-05-22/23) to Friday 2026-05-29 to accommodate.
- **Token brokering moved IN scope (2026-05-19).** Substantial new feature with ToS / privacy / accounting surface. Highest-risk item in the milestone. Chosen over per-user-key-routing because it creates a sticky Plus subscriber benefit.
- **Waitlist = throttled-access (Linear / OpenAI API style)**, not marketing-waitlist (Dropbox / Robinhood). Synapse needs to LIMIT, not GROW.
- **Telemetry rides existing event pipeline.** Zero new tables, zero new endpoints. New EventKinds: `BriefRendered`, `BriefRated`, `FirstNonOrientationPrompt`.
- **Sentry over toucan-js.** `@sentry/cloudflare` + `@sentry/hono`; toucan archived 2026-01-12.
- **Solo dogfood is the only pre-launch user signal.** Cold-laptop rehearsal is the bounded compromise against confirmation bias.

### Open questions / TODOs

- **BUG-01 root cause refuted, not the Promise.all hypothesis.** Real cause was `handoff_events` table missing from prod Supabase — schema drift between `supabase/migrations/*.sql` and prod went undetected. **Process gap:** no drift detection between migration files and prod schema. Worth a separate cleanup task.
- **Phase 2, 4, 5 need per-phase research** before planning (IDENT, COLLAB, TOKEN were added after the 4-agent research wave). `/gsd:discuss-phase N` will invoke a researcher.
- **Workers Paid tier** needs verification — assumption until proven otherwise.
- **Linux daemon path** is unverified at launch unless a Linux machine is accessed during Phase 1.

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

## Session Continuity

**To resume work in a fresh session:**

1. Read `.planning/PROJECT.md` for project + milestone context
2. Read `.planning/REQUIREMENTS.md` for the 23 v1 requirements + traceability
3. Read `.planning/ROADMAP.md` for the 7-phase plan and dependency graph
4. Read this `.planning/STATE.md` for current position
5. Read `.planning/research/SUMMARY.md` for technical decisions on Phases 1, 3, 6
6. Read `docs/BUGS.md` for the canonical "what's still broken" list

**Next command:** `/gsd:verify-work 2` — phase-level UAT for IDENT-01 + IDENT-02 against the 3 ROADMAP success criteria. Verification gates: (a) events flushed by an authenticated daemon carry `actor_user_id = public.users.id` — no "default" rows; (b) machine B SessionStart for a project that already has machine A events produces a brief including machine A activity within one pull cycle; (c) existing e2e roundtrip passes + no regression in placeholder `cwd_<hash>` auto-resolve flow. **Operator action consolidated for next CF-enabled session:** `supabase db push` to apply migration 018 (column + merge_projects function) + `wrangler deploy` backend + frontend redeploy + monitor first CI run that includes the Playwright e2e step (~2-3 min added runtime). Slice 1b residual (OPS-01 + Plan 05 Sentry) unblocks separately on the CF-enabled machine. **CI invariant:** stay green at all times (per `feedback_ci_must_stay_green.md`).

## Critical Risks Active

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|------------|
| Token brokering ToS/privacy/accounting eats the window | Critical | 5 | MVP rule: ONE call path end-to-end, not full broker |
| 1101 isn't the reducer — Phase 1 takes 2 days not 0.5 | High | 1 | `wrangler tail` is the gate, not a step |
| Scope creep ("while I'm in here" cleanups) eats the window | High | All | Daily out-of-scope audit; BUGS.md overflow |
| Solo dogfood = confirmation bias | High | 6 | Cold-laptop rehearsal (LAUNCH-03) is the bounded compromise |
| Supabase invite email rate limits trip during launch | Medium | 6 | Verify current limit before opening floodgates |
