# Synapse

## What This Is

Synapse captures Claude Code coding sessions locally via filesystem hooks, syncs them to a backend, and materializes a per-project "handoff brief" so the next session resumes with full context. It targets developers running Claude Code (and adjacent MCP-capable tools like Cursor and Windsurf) who want session context to persist across resumes, machines, and collaborators. Today the loop works end-to-end on disk; cloud sync is in flight.

## Core Value

**The next session knows where the last one left off.** Everything else can degrade — billing, dashboard, multi-tool integrations — but the capture → daemon → backend → brief loop must work reliably. If a developer can't trust that this conversation will be findable, summarizable, and useful in the next session, nothing else matters.

## Requirements

### Validated

<!-- Capabilities shipped before this milestone and confirmed working in production. -->

- ✓ **Capture daemon** subscribes to 6 Claude Code hook types (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd, SubagentStop) and writes events to local `~/.synapse/projects/<id>/events.jsonl` — existing
- ✓ **Backend events pipeline** (Cloudflare Worker `POST /api/events/batch`) upserts events by `event_id` with idempotent dedup, auto-creates projects from `cwd_<hash>` placeholders, materializes `ProjectStatus` via a reducer — existing
- ✓ **MCP server** exposes workspace tools (`list_insights`, `save_insight`, `list_conversations`, etc.) to Cursor / Windsurf / Claude Code — existing
- ✓ **PKCE browser-OAuth CLI auth** with per-device labeled keys, 3/unlimited tier limits, revoke-and-resign flow — shipped today via `a8ecf98` + `34de058`
- ✓ **launchd / systemd daemon supervision** with auto-start, log redirection, KeepAlive — installed by `synapse init`; plist+argv fixes shipped today via `d3cd771` + `025a814`
- ✓ **SvelteKit dashboard** at synapsesync.app — account, projects, conversations, insights, billing views — existing
- ✓ **Stripe-to-Creem billing migration** with Plus tier — existing
- ✓ **Supabase Postgres** with RLS for handoff_events, projects, users, api_keys, conversations — existing

### Active

<!-- Stabilize-for-launch milestone — target Friday 2026-05-29 (10 days from today, 2026-05-19). -->
<!-- Full REQ list with acceptance criteria in .planning/REQUIREMENTS.md -->

**Backend stabilization + observability**
- [ ] **BUG-01** — Backend `/api/events/batch` Cloudflare 1101 fixed; daemon flushes succeed end-to-end (BUGS.md #1, P0)
- [ ] **BUG-02** — `synapse capture status` accurately reports daemon state under launchd / systemd (BUGS.md #2, P1)
- [ ] **BUG-03** — Wizard's MCP configs work on proxy-restricted networks (BUGS.md #3, P1)
- [ ] **BUG-04** — `synapse init` writes project-local `.mcp.json` (BUGS.md #4, P1)
- [ ] **OBS-01** — Cloudflare Worker exceptions captured by Sentry (`@sentry/cloudflare` + `@sentry/hono`)

**Telemetry — quality + speed signals**
- [ ] **MEAS-01** — Brief-usefulness signal: thumbs Y/N rating via `/synapse-rate` slash command
- [ ] **MEAS-02** — Time-to-context signal: `BriefRendered` + `FirstNonOrientationPrompt` events
- [ ] **MEAS-03** — Minimal dashboard view (rating rate + median TTC per project)
- [ ] **MEAS-04** — Brief content hash on `BriefRendered` events (hidden prereq for MEAS-01)

**Multi-device + identity (added 2026-05-19)**
- [ ] **IDENT-01** — Events carry the real authenticated `actor.user_id`, not the `"default"` placeholder
- [ ] **IDENT-02** — Same-user cross-device sync: machine B pulls project status from machine A

**Cross-user collaboration (added 2026-05-19)**
- [ ] **COLLAB-01** — Invite UI for project owners to invite other users by email
- [ ] **COLLAB-02** — Accept UI for invited users to join projects
- [ ] **COLLAB-03** — Member-aware briefs (multi-actor view)

**Token brokering — Synapse-internal LLM routing (added 2026-05-19)**
- [ ] **TOKEN-01** — Plus subscribers opt-in to lend LLM API tokens; encrypted per-user credential storage
- [ ] **TOKEN-02** — Token broker routes Synapse-internal LLM calls across pooled accounts with failover
- [ ] **TOKEN-03** — Attribution & audit dashboard for lending users (no content disclosure cross-user)
- [ ] **TOKEN-04** — ToS / consent update for Plus signup + opt-in flow

**Public launch with waitlist throttle**
- [ ] **LAUNCH-01** — `synapsesync.app/signup` queues new emails to `waitlist` table (no auth user minted at signup)
- [ ] **LAUNCH-02** — Admin endpoint admits waitlist via Supabase `inviteUserByEmail`; built-in activation email
- [ ] **LAUNCH-03** — Cold-laptop rehearsal documented in `.planning/launch-rehearsal.md`

**Pre-launch dogfood + ops**
- [ ] **DOG-01** — 3+ consecutive days of personal Claude Code use captured + briefed + rated
- [ ] **OPS-01** — Cloudflare Workers Paid tier verified before launch

### Out of Scope

<!-- Explicit exclusions for this milestone — re-evaluable after launch + signal. -->

- **Active broadcast (HN, Twitter, dev community announcements)** — soft launch via waitlist first; broadcast happens after signal confirms it's worth amplifying
- **Friend / external pre-launch testing** — solo dogfood is the chosen pre-launch signal (speed over onboarding-confidence, per Questioning #3)
- ~~Team / multi-user collaboration features~~ — **MOVED IN SCOPE** as COLLAB-01..03 + TOKEN-01..04 (decision 2026-05-19; launch slid to 2026-05-29 to accommodate)
- **Marketing landing polish, README rewrites, brand work** — current landing + README ship as-is unless they actively block install
- **BUGS.md P2-P4 items** — 409 device-picker UI, dashboard rename UI, legacy key migration, backend auto-deploy, reducer perf, frontend a11y warnings, orphan tables. Tracked, not blocking launch
- **Decisions about OSS / commercial path / kill-or-continue** — explicitly deferred to "after launch + signal" per Questioning #4
- **AI/LLM-based brief improvements** — current heuristic + LLM-fallback synth ships as-is; quality measured by ratings before changes

## Context

- **Brownfield project, ~2 months of prior development** (March 2026 → present). Codebase map at `.planning/codebase/` documents existing architecture, stack, conventions, and concerns
- **Two-remote setup**: `tanmain/synapse` (primary, work happens here) is bot-mirrored to `metanmai/synapse` (CI runs there). All commits sync automatically; pull-requests can come from either side
- **Today's session (2026-05-18)** shipped the per-device CLI keys feature end-to-end (CLI device-name passing → frontend forwarding → backend label minting) and fixed 5 install-pipeline bugs (wizard not installing hooks, plist argv mangling, missing `launchctl load`, wrong script path). Daemon is now alive locally via launchd (PID 96819) but cloud sync blocked by REQ-BUG-01
- **Outstanding bugs cataloged in `docs/BUGS.md`** (15 items across P0-P4) with code locations + fix sketches. This file is the canonical "what's still broken" list — mirrored across both remotes
- **No external users yet** — clean-slate breaking changes are acceptable; backwards-compat is not a constraint (per `feedback_no_other_users.md`)
- **Capture pipeline is at-least-once + idempotent**: client appends to `events.jsonl`, watermark only advances on full-batch success, backend upserts by `event_id` with dedup. No events lost during the current 1101 outage

## Constraints

- **Timeline**: Launch by **Friday 2026-05-29** — 10 days from today (2026-05-19). Was originally 5 days targeting EoW; expanded on 2026-05-19 to accommodate cross-user collaboration and token-brokering scope additions. Still tight; drives ruthless prioritization within the new window
- **Solo developer**: One person executing. No team coordination overhead, but attention is the bottleneck
- **Tech stack pinned**: TypeScript across all four workspaces (mcp, backend, frontend, packages/shared). No language switches this milestone. Cloudflare Workers (backend) + Cloudflare Pages or Vercel (frontend) + Supabase Postgres
- **Backend deploy is manual**: No auto-deploy GitHub Action; `wrangler deploy` runs from a machine with the Cloudflare API token. Production can drift from main if deploy is forgotten (BUGS.md #10) — discipline-based
- **Corporate network proxy**: Some npm / pypi / npx egress is blocked by Netskope. Affects install paths (`npx synapsesync` fails on this network — REQ-BUG-03). Bypass requires tethering or a different network
- **Pre-push hook runs full verify** (`npm run lint && npm run typecheck && npm run test`) on every push — slows pushes ~25s but catches regressions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stabilize then decide (no pre-committed post-launch direction) | Decision quality improves with real signal; pre-committing now would foreclose options | — Pending |
| Solo dogfood is the only pre-launch user signal | Speed > onboarding-confidence in a 5-day window; "Just me" was the explicit choice over "Me + 2-3 close devs" | — Pending |
| Waitlist throttle (not full open signup) | Preserves option to slow rollout if backend strains under load; keeps blast radius small for any post-launch bug | — Pending |
| Telemetry shape: ratings (quality) + timestamps (speed), both | Crossplots well — surfaces "fast but inaccurate" vs "slow but useful" modes that a single metric would miss | — Pending |
| BUGS.md tracked in repo as `docs/BUGS.md`, not GitHub Issues | Two-remote bot-mirror setup makes issue tracking on either remote invisible from the other; a checked-in markdown file mirrors automatically | ✓ Good (already validated this session) |
| Per-device CLI keys with `cli-<sanitized-hostname>` labels | Earlier model silently invalidated old devices on each sign-in; new model adds devices independently with tier limits + revoke-and-resign for the limit case | ✓ Good (shipped 2026-05-18, verified end-to-end) |
| Cross-user collaboration IN scope for v1 launch (2026-05-19) | The "stabilize then decide" framing was challenged when the user re-scoped to include multi-device + cross-user sharing. Backend already has `project_members` + invites endpoint — finishing the UI is bounded work | — Pending |
| Token brokering (pool Plus subscribers' LLM tokens for Synapse-internal calls) IN scope for v1 (2026-05-19) | Substantial new feature with ToS / privacy / accounting surface. Highest-risk item in the milestone. Chosen over per-user-key-routing because it creates a sticky Plus subscriber benefit | — Pending; flagged as launch-slip risk |
| Launch slipped from EoW (2026-05-22/23) to Friday 2026-05-29 to fit scope additions | 5 days too tight for ~6 days of new work on top of existing stabilization. 10-day window absorbs the additions but token brokering remains tight | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-19 after scope expansion (cross-user collab + token brokering added, launch slid to 2026-05-29)*
