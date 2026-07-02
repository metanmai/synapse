---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
last_updated: "2026-05-20T09:36:16.554Z"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 5
  completed_plans: 4
  percent: 0
---

# State — Stabilize-for-Launch Milestone

*Last updated: 2026-05-20 — BUG-01 fully closed (migration restore + defensive swap deployed); SessionStart hook learns STATE.md fallback (`d61857b`); Phase 2 context gathered (`f445a1d`); Phase 2 research + validation + UI-SPEC + patterns locked (`2bfbb29` + `8c4b322` + `9872e06` + `fa95b42`); Phase 2 plans approved by checker — 5 plans in 4 waves, all 10 dimensions PASS, 8 non-blocking flags; ready for `/gsd:execute-phase 2`; OPS-01 + Plan 05 remain for slice 1b*

## Project Reference

**Project:** Synapse — context management tool that captures AI coding sessions and surfaces insights across projects.

**Core value:** The next session knows where the last one left off. The capture → daemon → backend → brief loop is the non-negotiable spine; everything else can degrade.

**Current milestone:** Stabilize-for-launch. Public launch with waitlist throttle by **Friday 2026-05-29** (10 days from today, 7 working days).

**Current focus:** Phase 1 — Stabilize backend (BUG-01 1101 root-cause via `wrangler tail`), wire Sentry, fix install-time UX bugs, verify Workers Paid tier.

## Current Position

- **Phase:** Phase 1 — Stabilize Backend & Observability (**slice 1a-prime — 4 plans, npm-install-free**)
- **Plan:** Slice 1a-prime ✅ COMPLETE (4 plans, 17 RED tests → GREEN). Slice 1b ⏳ partial: BUG-01 ✅ closed (migrations 015/016/017 re-applied + Promise.allSettled defensive swap deployed `16a4de1`+`2eb158b`). Remaining 1b: OPS-01 (wrangler whoami screenshot) + Plan 05 (Sentry).
- **Status:** BUG-01, BUG-02, BUG-03, BUG-04, BUGS-MD-12 all closed in prod. Account reset complete; one fresh project on dashboard. CF git auto-deploy confirmed working.
- **Roadmap progress:** 0/7 phases complete

**Slice routing (2026-05-19, updated):** Phase 1 originally split into 1a (wrangler-free) + 1b (CF machine). Pre-execution audit revealed Plan 05's `npm install @sentry/*` is also Netskope-blocked here. So slice 1a was further narrowed to "1a-prime": BUG-02, BUG-03, BUG-04, BUGS.md #12 land here; OBS-01 (full — code + deploy + verify) consolidated into slice 1b alongside BUG-01 + OPS-01. Phase is complete only when both slices ship.

```
[░░░░░░░░░░░░░░░░░░░░] 0% — 0 of 7 phases shipped
```

## Performance Metrics

- **Window:** 2026-05-19 → 2026-05-29 (10 days, ~7 working days)
- **Phases planned:** 7
- **Phases shipped:** 0
- **Requirements v1:** 23 (all mapped, 100% coverage)
- **Days remaining:** 10

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
- 2026-05-20 (today): BUG-01 closed on two layers — functional (migrations 015/016/017 re-applied to restore `handoff_events`) + defensive (Promise.allSettled swap deployed via CF git auto-integration, `16a4de1` + `2eb158b`). Account reset performed; one fresh project on dashboard. SessionStart hook learned STATE.md fallback so cold-start briefs surface the repo's hand-curated context instead of the apologetic "no cached context" string (`d61857b`). BUGS.md + STATE.md stale-state cleanup (`ce0c253`): 5 closed bugs moved to Closed, #10 rewritten as "CF git auto-deploy can go silent." Phase 2 context gathered (`f445a1d`): same-user multi-device identity + cross-device discovery; 9 decisions locked. Phase 2 research (`2bfbb29`) + validation strategy (`8c4b322`) produced: 4 natural vertical slices (Identity bootstrap / Cross-device link + eager pull / Device-origin brief / Manual override UI), 9 pitfalls documented, vitest test infra mapped, Wave 0 gaps enumerated. Workflow paused at UI gate — user chose `/gsd:ui-phase 2` before plan-phase resumes. UI-SPEC produced + verified (`9872e06`): inline-expand pattern mirroring `DangerZone.svelte`, 0 new tokens, 0 new deps, 1 new component (`LinkPicker.svelte`); checker passed all 6 dimensions + scope D-07. Pattern map produced (`fa95b42`, 21 files with concrete analog file:line refs). Plans produced + checker-approved (`68d5633`): 5 PLAN.md files in 4 waves (TDD scaffolding Wave 1, slices A+D parallel Wave 2, slice B with BLOCKING schema push Wave 3, slice C with BLOCKING UI smoke Wave 4). Plan-checker passed 10/10 dimensions with 8 non-blocking flags. ROADMAP.md updated by planner with the 5-plan list. Then expanded to **6 plans in 5 waves** (`add5bbb`) by adding Plan 02-06: Playwright browser-driven e2e for the LinkPicker UI (Chromium only, mocked backend, wired into CI's existing push-to-main e2e job). Phase 2 is fully planned and ready for `/gsd:execute-phase 2`.

## Session Continuity

**To resume work in a fresh session:**

1. Read `.planning/PROJECT.md` for project + milestone context
2. Read `.planning/REQUIREMENTS.md` for the 23 v1 requirements + traceability
3. Read `.planning/ROADMAP.md` for the 7-phase plan and dependency graph
4. Read this `.planning/STATE.md` for current position
5. Read `.planning/research/SUMMARY.md` for technical decisions on Phases 1, 3, 6
6. Read `docs/BUGS.md` for the canonical "what's still broken" list

**Next command:** `/gsd:execute-phase 2` — 6 plans ready in 5 waves: Wave 1 (`02-01` Wave 0 RED test scaffolding), Wave 2 parallel (`02-02` Slice A identity bootstrap + `02-03` Slice D device-origin brief), Wave 3 (`02-04` Slice B cross-device link + migration 018 + BLOCKING schema push checkpoint), Wave 4 (`02-05` Slice C manual link UI + merge RPC + LinkPicker + BLOCKING UI smoke), Wave 5 (`02-06` Playwright browser-driven e2e for LinkPicker + CI wiring + BLOCKING local-install checkpoint + BLOCKING CI-green checkpoint). Slice 1b residual unblocks separately on the CF-enabled machine. **Open flags for executor:** F1 (Plan 02-05 collapses migration write+push — consider creating 019 instead of appending 018), F4 (D-09 uses `actor.hostname` not `cli-<device>` — CONTEXT.md D-09 should be amended to match RESEARCH Open Question 2 recommendation), F8 (stub-backend.ts missing from Plan 02-04 files_modified). **02-06 specific:** local Playwright install requires tethering to a non-corporate network (Netskope blocks npm install of new deps); CI install path is unaffected.

## Critical Risks Active

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|------------|
| Token brokering ToS/privacy/accounting eats the window | Critical | 5 | MVP rule: ONE call path end-to-end, not full broker |
| 1101 isn't the reducer — Phase 1 takes 2 days not 0.5 | High | 1 | `wrangler tail` is the gate, not a step |
| Scope creep ("while I'm in here" cleanups) eats the window | High | All | Daily out-of-scope audit; BUGS.md overflow |
| Solo dogfood = confirmation bias | High | 6 | Cold-laptop rehearsal (LAUNCH-03) is the bounded compromise |
| Supabase invite email rate limits trip during launch | Medium | 6 | Verify current limit before opening floodgates |
