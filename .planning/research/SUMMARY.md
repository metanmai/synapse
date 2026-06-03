# Research Summary — Synapse Stabilize-for-Launch

**Milestone:** Public launch with waitlist throttle by EoW (2026-05-22 / 23).
**Synthesizes:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (all 2026-05-19).
**Reader:** roadmap creator (next step). All 4 research docs converged on most key points; this document records the convergent picture + flags the 3-4 places they diverged.

---

## Decision Set

Prescriptive technical decisions that all 4 agents agreed on (or where a clear winner emerged after reconciling disagreements). Each decision cites the grounding doc.

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| D1 | **Fix the 1101 before adding any new code.** `wrangler tail --name synapse --format pretty` against prod to capture the real stack trace. Hypothesis: `Promise.all(recomputeProjectStatus(...))` at `backend/src/api/events-batch.ts:132` rejects in a context Hono can't catch. Likely one-line swap to `Promise.allSettled` + per-project try/catch. | All 4 agents flagged this as #1 priority. Without it: launch traffic IS the canary. | Stack §Worker Observability, Pitfalls #1, Architecture §Stabilization |
| D2 | **`@sentry/cloudflare ^10.51.0` + `@sentry/hono`**, NOT toucan-js. Wire Sentry into `app.onError` AND `ctx.waitUntil(reportError(...))` for the unhandled-rejection escapes. Source map upload via Wrangler. | toucan-js archived 2026-01-12. Sentry's first-party CF SDK is the maintained path; `nodejs_compat` is already on. | Stack §Worker Observability |
| D3 | **Telemetry rides existing event pipeline. Zero new tables, zero new endpoints.** Add new `EventKind`s in `packages/shared/src/handoff/events.ts`: `BriefRendered`, `BriefRated`, `FirstNonOrientationPrompt`. Reducer folds them into `ProjectStatus.recent_ratings` and `recent_time_to_context_ms`. | Three of four agents independently arrived at this. Inherits at-least-once + idempotent + RLS for free. ~150 LOC. | Features §Brief Rating + §TTV, Architecture §Telemetry |
| D4 | **Brief content hash is a hidden prerequisite for D3.** Add `payload.brief_hash: sha256(brief_text)` to `BriefRendered` events so ratings can dedupe on the same brief across sessions. | Without it, "this brief was useful" doesn't have a stable target. | Features §Brief Rating "Brief Identity" subsection |
| D5 | **Time-to-context = behavioral, not content-based.** "First non-orientation prompt" = `first UserPromptSubmit followed within 30s by a ToolUsed event`. Idle threshold cap: 30 min (matches existing `IDLE_THRESHOLD_MS` in reducer.ts:4). | Behavioral definition avoids classifier complexity; existing event kinds already capture the signal. | Features §TTV |
| D6 | **Binary thumbs (👍/👎) with optional reason on 👎.** No 5-star. No required modal. Slash command `/synapse-rate` for input. | ChatGPT, GitHub Copilot, Microsoft Copilot Studio all chose binary after starting with 5-star. Reason-on-negative is the differentiator. | Features §Brief Rating |
| D7 | **Waitlist = throttled-access (Linear / OpenAI API style), NOT marketing-waitlist (Dropbox / Robinhood style).** New `waitlist` table (migration `018_waitlist.sql`), `/auth/signup` writes to it instead of creating a user, admin-only `/api/admin/waitlist/admit` mints users via `supabase.auth.admin.inviteUserByEmail`. | Almost every waitlist tool on the market (LaunchList, Waitlister, Prefinery) is built for viral/referral growth — wrong problem. Synapse needs to LIMIT, not GROW. | Features §Waitlist, Architecture §Waitlist |
| D8 | **`Resend ^6.12.3` for any standalone transactional email** (not the activation email itself). Activation uses Supabase's invite email; Resend is the path for future emails (welcome series, "you're up" reminders, etc.). | Resend = consensus indie pick, Workers-native, free-tier sufficient. Defers email-provider commitment for the first email type but keeps the path open. | Stack §Waitlist Throttle. **DIVERGENCE:** Architecture says "no new email provider needed" (Supabase only). Features says Resend. Reconciliation: Supabase invite for activation, Resend reserved for non-Supabase emails post-launch. |
| D9 | **Daemon detection via `launchctl print gui/$UID/<label>` exit code** (NOT parsing `launchctl list` output) + `systemctl --user is-active synapsesync.service` on Linux. PID file stays as tier-2 fallback. | Apple's man page explicitly warns `launchctl list` format isn't API. `is-active` is the documented systemd CLI. Symmetric with the install-side pattern in `os-service.ts`. | Stack §Install-Time UX, Pitfalls #10 |
| D10 | **MCP-command fallback for proxy-blocked `npx`:** try `which synapsesync` → absolute path; else `node <abs-path>/dist/index.js`; only emit `npx synapsesync` as last resort with a wizard warning. 2-second `fetch("https://registry.npmjs.org/-/ping")` is the proxy-detection probe. | Mirrors existing pattern in `cli/init.ts` for hook commands. | Stack §Install-Time UX |
| D11 | **Workers Paid tier verification gate** before launch (`wrangler whoami`). Free tier's 10ms CPU / 50 subrequests is unsafe for the batch endpoint regardless of the 1101 fix. | A single batch with 30 events × `recomputeProjectStatus` blows past the Free limits even without the bug. | Architecture §Cloudflare Constraints |
| D12 | **Don't add Cloudflare Turnstile or referral mechanics to the waitlist signup form.** Defer until first 48h of launch traffic show actual abuse. | Pre-launch over-engineering; reversible if needed. | Features §Anti-Features |

---

## Build Order (Phase Suggestions)

Reconciled from 4 phase proposals. Variations were minor — main disagreement was waitlist-vs-telemetry order (Features said waitlist→telemetry; Architecture and Pitfalls said telemetry→waitlist). Reconciliation: **both run in parallel after Phase 1** since they're architecturally independent; the milestone success criterion ("measurable signal at launch") is met if both ship by EoW.

Granularity = Standard (per `.planning/config.json`) → target 5-8 phases. Below proposes **6 phases**.

### Phase 1 — Stabilize backend (P0)

- **Goal:** Daemon flushes succeed end-to-end against the deployed Worker; observability catches future escapes
- **Requirements:** REQ-BUG-01
- **Top dependency:** `wrangler tail` to confirm root cause before patching (per D1)
- **T-shirt:** S (~0.5 day if cause matches hypothesis; M if it doesn't)
- **Pitfall mitigated:** #1 (1101 escapes app.onError, no test coverage)
- **Bundles:** Sentry wiring (D2) + Promise.allSettled + sequential per-project status recompute + integration test that exercises the real handler path (closes BUGS.md #5a)

### Phase 2 — Install-time UX polish (parallel with 3-5)

- **Goal:** Wizard and `synapse init` produce a working install on any reasonable network
- **Requirements:** REQ-BUG-02, REQ-BUG-03, REQ-BUG-04
- **Top dependency:** None (pure MCP-package work)
- **T-shirt:** S (~0.5 day)
- **Pitfall mitigated:** #10 (daemon detection across launchd + systemd), #11 (proxy-blocked configs)
- **Bundles:** D9 + D10 + adding `.mcp.json` write to `runInit`

### Phase 3 — Telemetry (parallel with 2, 4)

- **Goal:** Brief usefulness + time-to-context measurable per project
- **Requirements:** REQ-MEASURE-01, 02, 03
- **Top dependency:** Phase 1 done (no point capturing through a broken pipe). Hidden prereq: D4 brief_hash.
- **T-shirt:** M (~1 day)
- **Pitfall mitigated:** #2 (telemetry coupled to Core Value path) — addressed by D3 sidecar pattern
- **Bundles:** 3 new EventKinds, reducer extension, `/synapse-rate` slash command, dashboard TelemetryCard component

### Phase 4 — Waitlist (parallel with 2, 3)

- **Goal:** synapsesync.app accepts public signups, queues them, admin grants access in controlled batches with email notifications
- **Requirements:** REQ-LAUNCH-01, REQ-LAUNCH-02
- **Top dependency:** Workers Paid tier verified (D11)
- **T-shirt:** M (~1-1.5 days)
- **Pitfall mitigated:** #3 (waitlist without funnel instrumentation is invisible) — instrument the 4 funnel stages from the start
- **Bundles:** Migration 018 + `/api/admin/waitlist/admit` + `/auth/signup` divert + frontend signup form + admin-only granting UI + Supabase invite email config

### Phase 5 — Cold-laptop rehearsal & install verification

- **Goal:** A stranger on a fresh laptop can sign up → get invited → install → produce a working brief
- **Requirements:** REQ-LAUNCH-03
- **Top dependency:** Phases 1, 2, 4 done
- **T-shirt:** S (~0.5 day rehearsal + fixes for whatever it surfaces)
- **Pitfall mitigated:** #4 (solo dogfood = confirmation bias), #12 (looks-done-but-isn't checklist gap)
- **Bundles:** Run wizard on a clean VM or second machine; fix every friction point that's not "I'd know what to do, but a stranger wouldn't"

### Phase 6 — Dogfood + launch

- **Goal:** 3+ consecutive days of personal Claude Code sessions captured + briefed + rated, then flip the waitlist live
- **Requirements:** REQ-DOGFOOD-01
- **Top dependency:** Phases 1-5 done
- **T-shirt:** S engineering (~0 days work; ~3 days wall-clock observation)
- **Pitfall mitigated:** #5 (scope creep — Phase 6 has zero engineering scope by design)
- **Bundles:** Daily out-of-scope audit (per Pitfall #5), launch checklist execution, public open of synapsesync.app

---

## Critical Risks

Ranked by severity × likelihood. Each maps to the phase that neutralizes it.

| Risk | Severity | Phase | Mitigation summary |
|------|----------|-------|--------------------|
| **1101 isn't actually the reducer** — diagnostic hypothesis turns out wrong; Phase 1 takes 2 days instead of 0.5 | Critical | Phase 1 | Treat Phase 1 as research-then-fix (per Pitfalls open question). `wrangler tail` is the gate, not a step |
| **Workers Free tier under-capacity** for batch endpoint even after fix | High | Phase 4 | D11 verification gate; upgrade to Paid before launch |
| **Telemetry coupling breaks Core Value** — new EventKinds confuse reducer for capture events | High | Phase 3 | D3 sidecar pattern; integration test that exercises both event types against the reducer in a single session |
| **Solo dogfood misses UX gaps that show in <30min-user sessions** | High | Phase 5 | Cold-laptop rehearsal (REQ-LAUNCH-03) is the one mitigation that scales for the time budget |
| **Scope creep eats the 5-day window** — "while I'm in here" cleanups, BUGS.md P2 work, README polish | High | Cross-cutting | Daily out-of-scope audit (per Pitfall #5); BUGS.md as overflow; `## Out of Scope` in PROJECT.md is the source of truth |
| **Supabase invite email rate limits** trip during waitlist activation | Medium | Phase 4 | Verify current limit (training data says ~30/hr) against current Supabase free tier before opening floodgates; document |
| **Launch traffic is the canary** if observability is partial | Medium | Phase 1 | Sentry + structured logging ship BEFORE Phase 4 — non-negotiable ordering |

---

## Non-Obvious Prerequisites

These look like they ship inside a feature phase but are hidden prerequisites that should land first or as the first task of their phase. Easy to miss; high cost if missed.

1. **Brief content hash field on `BriefRendered` events** (Phase 3, first task)
   - Why: ratings need a stable identity for the brief they're rating. Without it, rating-rate over time is unmeasurable.
   - Where: `packages/shared/src/handoff/events.ts` and the brief renderer.

2. **`schema_version` on `ProjectStatus`** (Phase 3, before adding new fields)
   - Why: reducer adding `recent_ratings` / `recent_time_to_context_ms` is a backwards-incompatible status shape change. Status consumers (dashboard, brief renderer) need to know which schema they're reading.
   - Where: `packages/shared/src/handoff/types.ts`, then reducer + status fetch path.

3. **`waitlist` admission triggers existing migration-014 user-creation trigger** (Phase 4, verify before opening signups)
   - Why: `supabase.auth.admin.inviteUserByEmail` mints the auth user; the existing migration-014 trigger then creates the `public.users` row. If this trigger silently fails for invited users, the invited user can never sign in.
   - Where: `supabase/migrations/014_robust_auth_user_trigger.sql` + new `018_waitlist.sql`.

4. **`SENTRY_DSN` env binding in `wrangler.jsonc`** (Phase 1, before Sentry SDK code)
   - Why: forgetting this turns the Sentry init into a silent no-op; you'll think observability is on when it isn't.
   - Where: `backend/wrangler.jsonc` and `backend/src/lib/observability.ts` (new file).

5. **Funnel instrumentation for the waitlist** (Phase 4, ship with feature, not as follow-up)
   - Why: Pitfall #3 — a waitlist without funnel events (signup attempted, signup queued, invite sent, invite clicked, signed-in, first session) is invisible. By the time you realize the email-open rate is 5%, you've burned weeks on a dead funnel.

---

## Open Questions for Phase Planning

Each phase planner will need to decide these. Proposed defaults listed; planner can override.

| # | Question | Proposed default | Rationale |
|---|----------|------------------|-----------|
| Q1 | Workers plan tier — confirm Paid? | Verify in Phase 1 via `wrangler whoami`; assume Paid until proven otherwise | All architecture assumes 30s CPU |
| Q2 | Activation email path: Supabase built-in or Resend? | **Supabase invite for activation** (zero net-new infra); **Resend reserved for non-activation emails** post-launch | Reconciles D8 divergence above |
| Q3 | Admin auth for waitlist-admit endpoint: existing X-Admin-Secret header or new session-based admin role? | Existing `X-Admin-Secret` header pattern from `backend/src/api/admin.ts` | Pre-launch over-engineering to build sessions for a 1-user admin surface |
| Q4 | Time-to-context outlier cap | 30 min (matches `IDLE_THRESHOLD_MS` in `mcp/src/capture/daemon.ts:4` and reducer) | Pre-existing convention |
| Q5 | Linux daemon verification scope | Document that Linux path is unverified at launch unless a Linux machine is accessed for testing during Phase 2 | Realistic for solo dev; not a launch blocker since target users are likely macOS-heavy |
| Q6 | Where does the brief surface for rating? Dashboard? Slash command output? Both? | Slash command (`/synapse-rate`) Phase 3a; dashboard "recent briefs" view as Phase 3b stretch | Slash command is zero-UI; dashboard is the natural rating surface but more code |

---

## What This Means for the Roadmap

1. **6 phases, 4-5 days of work** — fits the timeline if Phase 1's 1101 hypothesis is correct.
2. **Parallel tracks possible** for Phases 2/3/4 once Phase 1 is done; sequencing is dependency-driven, not engineer-driven.
3. **Phase 5 (cold-laptop rehearsal) is the highest-leverage UX check** — defends against solo-dogfood blindness.
4. **Phase 6 (dogfood + launch) has zero engineering scope by design** — any code change during Phase 6 is a scope-creep signal.
5. **All BUGS.md P2-P4 stays out of scope** for this milestone — explicitly listed in PROJECT.md `## Out of Scope`.

Roadmapper: this is the input. Phase names below are sketches — feel free to rename for clarity, but preserve the dependency graph (Phase 1 first; Phase 6 last; Phases 2-5 are parallel-friendly).
