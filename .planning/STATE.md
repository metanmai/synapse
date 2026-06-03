# State — Stabilize-for-Launch Milestone

*Last updated: 2026-05-19 — Phase 1 plans verified (5 plans, 3 waves); ready to execute slice 1a*

## Project Reference

**Project:** Synapse — context management tool that captures AI coding sessions and surfaces insights across projects.

**Core value:** The next session knows where the last one left off. The capture → daemon → backend → brief loop is the non-negotiable spine; everything else can degrade.

**Current milestone:** Stabilize-for-launch. Public launch with waitlist throttle by **Friday 2026-05-29** (10 days from today, 7 working days).

**Current focus:** Phase 1 — Stabilize backend (BUG-01 1101 root-cause via `wrangler tail`), wire Sentry, fix install-time UX bugs, verify Workers Paid tier.

## Current Position

- **Phase:** Phase 1 — Stabilize Backend & Observability (**slice 1a — wrangler-free subset**)
- **Plan:** 5 PLAN.md files (Wave 1: 01-01 scaffolding; Wave 2: 01-02, 01-03, 01-05 parallel; Wave 3: 01-04)
- **Status:** Plans verified (plan-checker VERIFICATION PASSED on iter 3); ready to execute
- **Roadmap progress:** 0/7 phases complete

**Slice routing (2026-05-19):** Phase 1 split into 1a (BUG-02/03/04 + Sentry code + daemon backoff; lands on this device) and 1b (BUG-01 + OBS-01 deploy + OPS-01; lands on the CF-enabled machine). Both slices share `01-CONTEXT.md`. Phase is complete only when both ship.

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

- **BUG-01 root cause** is hypothesized (Promise.all in `recomputeProjectStatus`) but unverified. Phase 1 is research-then-fix; `wrangler tail` against prod is the gate.
- **Phase 2, 4, 5 need per-phase research** before planning (IDENT, COLLAB, TOKEN were added after the 4-agent research wave). `/gsd:discuss-phase N` will invoke a researcher.
- **Workers Paid tier** needs verification — assumption until proven otherwise.
- **Linux daemon path** is unverified at launch unless a Linux machine is accessed during Phase 1.

### Blockers

None right now. Phase 1 ready to plan.

### Recent activity

- 2026-05-18: Shipped per-device CLI keys end-to-end (`a8ecf98` + `34de058`) and fixed 5 install-pipeline bugs (`d3cd771` + `025a814`). Daemon alive locally via launchd; cloud sync blocked by BUG-01.
- 2026-05-19 (today): Scope re-expansion (COLLAB + TOKEN added). 4-agent research consolidated into `research/SUMMARY.md`. Requirements rewritten. Roadmap created (this artifact).

## Session Continuity

**To resume work in a fresh session:**

1. Read `.planning/PROJECT.md` for project + milestone context
2. Read `.planning/REQUIREMENTS.md` for the 23 v1 requirements + traceability
3. Read `.planning/ROADMAP.md` for the 7-phase plan and dependency graph
4. Read this `.planning/STATE.md` for current position
5. Read `.planning/research/SUMMARY.md` for technical decisions on Phases 1, 3, 6
6. Read `docs/BUGS.md` for the canonical "what's still broken" list

**Next command:** `/gsd:plan-phase 1` (Phase 1: Stabilize Backend & Observability)

## Critical Risks Active

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|------------|
| Token brokering ToS/privacy/accounting eats the window | Critical | 5 | MVP rule: ONE call path end-to-end, not full broker |
| 1101 isn't the reducer — Phase 1 takes 2 days not 0.5 | High | 1 | `wrangler tail` is the gate, not a step |
| Scope creep ("while I'm in here" cleanups) eats the window | High | All | Daily out-of-scope audit; BUGS.md overflow |
| Solo dogfood = confirmation bias | High | 6 | Cold-laptop rehearsal (LAUNCH-03) is the bounded compromise |
| Supabase invite email rate limits trip during launch | Medium | 6 | Verify current limit before opening floodgates |
