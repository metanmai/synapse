# Requirements — Stabilize-for-Launch Milestone

**Target:** Public launch with waitlist throttle by **Friday 2026-05-29** (10 days from today, 2026-05-19).
**Source:** Synthesized from PROJECT.md (questioning), research/SUMMARY.md (4-agent ecosystem research), and docs/BUGS.md (existing bug catalog).
**Scope:** Solo dev, 10-day timeline. Anything not below is explicitly out-of-scope for this milestone.

**Scope additions (decided after initial research):** Real-user-id wiring, multi-device sync for same user, cross-user collaboration, and Synapse-internal token brokering. These were not in the 4-agent research; the roadmapper or per-phase research will need to study them before planning the relevant phases.

---

## v1 Requirements

### Backend stabilization

- [x] **BUG-01** — Backend `POST /api/events/batch` no longer throws unhandled Cloudflare 1101 on real event payloads. Daemon flushes succeed end-to-end against production. *Acceptance: `node mcp/scripts/test-cli-flow.mjs` (or equivalent) produces "all events flushed, 0 errors" against `api.synapsesync.app` for a 3-project / 100-event batch.*
- [x] **BUG-02** — `synapse capture status` accurately reports daemon state when the daemon is running under launchd or systemd. *Acceptance: with a launchd-supervised daemon alive, `synapse capture status` shows "Daemon: running" + the launchd PID.*
- [x] **BUG-03** — Wizard's MCP configs work on proxy-restricted networks (Netskope, corporate firewalls). *Acceptance: fresh wizard run on a network where `npx` returns 403 produces a `.mcp.json` whose `command` field resolves to a binary on disk, and the MCP server starts successfully when Claude Code opens.*
- [x] **BUG-04** — `synapse init` writes the project-local `.mcp.json` (in addition to hooks + service + config), so the MCP server is reachable from Claude Code in this project. *Acceptance: after `synapse init --api-key X` and a Claude Code restart, `mcp__synapse__tree()` returns successfully.*

### Observability

- [ ] **OBS-01** — Cloudflare Worker exceptions captured by Sentry (`@sentry/cloudflare` + `@sentry/hono`). Includes the unhandled-rejection escapes that `app.onError` misses (Pitfall #1 grounding). *Acceptance: forcing a deliberate unhandled rejection in events-batch.ts produces a Sentry event with the real stack trace within 1 minute.*

### Telemetry — quality + speed signals

- [ ] **MEAS-01** — Brief-quality rating: thumbs Y/N on each rendered brief, with optional reason on negative. Captured via `/synapse-rate` slash command. Persisted server-side as a `BriefRated` event. *Acceptance: after using a Claude Code session with a Synapse brief, running `/synapse-rate up` stores a rating against the displayed brief and increments a per-project rating-count.*
- [ ] **MEAS-02** — Time-to-context auto-tracking: daemon emits `BriefRendered` at SessionStart and `FirstNonOrientationPrompt` at first `UserPromptSubmit` followed within 30s by a `ToolUsed` event. Both events flow through the existing pipeline. *Acceptance: server can compute the elapsed-ms between the two events for any captured session.*
- [ ] **MEAS-03** — Minimal dashboard view: per-project rating-rate (% thumbs-up over last N briefs) + median time-to-context (last N sessions). Visible at `synapsesync.app/dashboard` or equivalent. *Acceptance: a project with 5 rated briefs + 5 timed sessions displays both metrics correctly.*
- [ ] **MEAS-04** — Brief content hash on `BriefRendered` events (hidden prerequisite). `payload.brief_hash: sha256(brief_text)` so ratings dedupe on the same brief across sessions. *Acceptance: rendering the same brief twice produces identical hashes; rating either dedupes server-side.*

### Public launch with waitlist throttle

- [ ] **LAUNCH-01** — `synapsesync.app/signup` accepts new email addresses and queues them on a `waitlist` table (migration `018_waitlist.sql`). Auth user is NOT minted at signup. *Acceptance: a fresh email submitted to the public form creates a `waitlist` row in `status: 'pending'`; no `auth.users` row appears yet.*
- [ ] **LAUNCH-02** — Admin endpoint `POST /api/admin/waitlist/admit` (auth via existing `X-Admin-Secret` header) mints a user via `supabase.auth.admin.inviteUserByEmail`. Activation email is the Supabase built-in invite email. *Acceptance: hitting the admin endpoint for a pending waitlist email moves the row to `status: 'admitted'` AND the email recipient receives a usable activation link.*
- [ ] **LAUNCH-03** — Cold-laptop rehearsal: a fresh-laptop scenario (clean VM or second machine) walks through signup → wait → admit → invite click → wizard → first brief. Each friction point identified is either fixed or documented as launch-blocker. *Acceptance: documented in `.planning/launch-rehearsal.md` with pass/fail per stage and any defects filed back into this milestone.*

### Pre-launch dogfood

- [ ] **DOG-01** — 3+ consecutive days of personal Claude Code sessions on this developer's machine: capture → flush → brief on next session, with no manual intervention beyond running Claude Code normally. *Acceptance: `synapse capture status` shows ≥3 days of session events flushed, ≥1 brief rendered per day, no manual `synapse` invocations beyond the rating slash command.*

### Workers tier verification

- [ ] **OPS-01** — Cloudflare Workers Paid tier verified (`wrangler whoami` + dashboard check). Free tier's 10ms CPU / 50-subrequest limits are unsafe for the batch endpoint regardless of bug fixes. *Acceptance: prod is on Paid before LAUNCH-01 flips live.*

### Multi-device & identity

- [x] **IDENT-01** — Events carry the real authenticated `actor.user_id` (the user's UUID from `public.users`), not the placeholder `"default"` currently emitted by the daemon. Daemon reads its identity from `~/.synapse/config.json` (set by `synapse init`); backend verifies via `authMiddleware`. *Acceptance: events flushed by the daemon for an authenticated user have `actor_user_id` equal to that user's UUID in `handoff_events`; no `"default"` rows after this lands.*
- [x] **IDENT-02** — Same-user cross-device sync: signing in on a second machine produces a daemon that pulls existing `ProjectStatus` from the backend and renders briefs that include context from the first machine. *Acceptance: on machine B (fresh install), `synapse init` + a Claude Code SessionStart for a project that has events from machine A produces a brief mentioning machine-A activity within 1 cycle.*

### Free/Plus tier redesign

- [x] **TIER-01** — Per-tier project, insight, conversation, device, and auto-sync policies are centralized behind tested accessors.
- [x] **TIER-02** — Free and Plus users are capped at 50 owned projects; the 51st create returns `402 PROJECT_QUOTA_EXCEEDED` across backend, CLI/brief, and browser surfaces.
- [x] **TIER-03** — A Free user's 11th conversation in a project silently evicts the oldest conversation by `updated_at`, including its messages; reads do not refresh LRU order.
- [x] **TIER-04** — A Free user's 11th active insight evicts the oldest active insight; a Plus user's overflow triggers asynchronous 10-to-3–5 LLM consolidation with scheduled retry on failure.
- [x] **TIER-05** — Stable per-machine UUIDs prevent duplicate device registration and enforce 3-device Free / 10-device Plus caps with a sign-out recovery flow.
- [x] **TIER-06** — Free users retain hook-driven boundary pushes and can run `synapsesync sync` manually, while the periodic daemon sync loop is Plus-only.
- [ ] **TIER-07** — A Free→Plus tier change activates daemon auto-sync within seconds without a daemon restart. *Open: the daemon currently caches billing status for five minutes; the planned `tier_revision` invalidation did not land.*
- [x] **TIER-08** — Project-context summary retrieval and its dashboard surface remain Plus-only while Free conversations and insights remain accessible.

### Cross-user collaboration

- [ ] **COLLAB-01** — Invite UI: project owner can invite another user by email to a project from the dashboard. Backend endpoint already exists (`POST /api/projects/:id/invites`); this requirement wires the UI. *Acceptance: clicking "Invite" in the dashboard for a project, entering an email, and submitting sends a Supabase invite email + creates a `project_members` row in `pending` state.*
- [ ] **COLLAB-02** — Accept UI: invited user can accept an invite from a dashboard notification or invite link, joining the project. *Acceptance: a freshly-invited user signing in sees an "Accept invite to <project>" prompt; accepting moves their `project_members` row to `accepted` and grants them read+write to the project's events.*
- [ ] **COLLAB-03** — Member-aware briefs: when multiple users contribute events to the same project, the brief surfaces *who* did what. The reducer already groups by `actor.user_id` (`packages/shared/src/handoff/reducer.ts`); briefs need to render the per-actor view. *Acceptance: a project with events from User A and User B produces a brief that distinguishes "A focused on X, B working on Y".*

### Token brokering (Synapse-internal LLM routing across pooled Plus subscriptions)

- [ ] **TOKEN-01** — Plus subscribers can opt-in to lending their LLM API tokens to the Synapse internal-call pool. Opt-in is explicit (toggle in account settings) with clear ToS disclosure on what calls are routed through their account. Per-user encrypted credential storage with RLS. *Acceptance: a Plus user can toggle "Lend tokens to Synapse pool" on/off; their LLM provider key is stored encrypted in a `pool_credentials` table that no other user can read.*
- [ ] **TOKEN-02** — Synapse-internal LLM calls (heuristic-synth fallback, brief LLM enhancement) route through the pool: token-broker selects the least-utilized pooled account, calls the LLM through that account's credentials, records the usage. Failover to the next account on rate-limit or auth error. *Acceptance: a Synapse-internal LLM call routed through the broker produces a usage record (provider, account_id, tokens_in, tokens_out, timestamp); when the chosen account hits a 429, the broker retries via the next account.*
- [ ] **TOKEN-03** — Attribution & audit: each Plus user can see in their account dashboard which Synapse calls used their tokens (timestamp + call type + token count). No content disclosure across user boundaries. *Acceptance: a Plus user's dashboard shows a list of "Calls routed through your tokens" with date, call type, and token counts, but never the content of those calls.*
- [ ] **TOKEN-04** — ToS / consent update on Plus signup + opt-in flow ensures the user explicitly understands their tokens may be used for other users' workflows. *Acceptance: the consent surface is in the Plus signup flow AND the lend-tokens toggle, with a link to a one-paragraph plain-English explanation in the ToS.*

---

## v2 (Deferred — not in this milestone)

Tracked in `docs/BUGS.md` and shipped post-launch based on real signal. Not blockers for the EoW launch:

- BUGS.md #5 — 409 DEVICE_LIMIT_REACHED device-picker UI
- BUGS.md #6 — Dashboard rename UI for `cli-*` keys
- BUGS.md #7 — Legacy `cli` key migration to `cli-legacy-<date>`
- BUGS.md #8-9 — Worktree-agent branches triage, feat/oss-readiness status
- BUGS.md #10 — Backend auto-deploy via GitHub Actions
- BUGS.md #11 — Incremental `recomputeProjectStatus` (perf)
- BUGS.md #12 — Daemon flush exponential backoff / circuit-breaker
- BUGS.md #13 — Frontend a11y warnings + unused CSS
- BUGS.md #14 — Orphan `handoff_sessions` / `handoff_issues` table cleanup
- Dashboard "recent briefs" view (Phase 3b stretch per SUMMARY.md Q6)

## Out of Scope

Explicit exclusions for this milestone. Reasons documented to prevent re-adding mid-sprint.

- **Active broadcast (HN / Twitter / dev community announcements)** — soft launch via waitlist first; broadcast happens after first-cohort signal confirms it's worth amplifying. *Re-evaluable after launch + 1 week.*
- **Friend / external pre-launch testing** — solo dogfood is the chosen pre-launch signal (per Questioning #3). Trading onboarding-confidence for speed. *Cold-laptop rehearsal (LAUNCH-03) is the bounded compromise.*
- ~~Team / multi-user collaboration features~~ — **MOVED IN SCOPE** as COLLAB-01..03 (decision: 2026-05-19 after questioning revision)
- **Marketing landing polish, README rewrites, brand work** — current landing + README ship as-is unless they actively block install. *Re-evaluable post-launch based on signup conversion rate.*
- **AI/LLM-based brief improvements** — current heuristic + LLM-fallback synth ships as-is; quality measured by ratings (MEAS-01) before any changes are made. *Avoid prematurely optimizing what we're trying to measure.*
- **Decisions about OSS / commercial path / kill-or-continue** — explicitly deferred to "after launch + signal." This milestone produces the SIGNAL; the decision happens later.
- **Cloudflare Turnstile + referral mechanics on waitlist signup** — pre-launch over-engineering. Re-evaluable if first 48h shows abuse.
- **Admin UI for waitlist management** — manual SQL or simple endpoint is enough for launch-volume. Build dashboard view only if waitlist grows past ~50 entries.
- **OpenTelemetry / OTLP traces** — Cloudflare's OTLP export is Paid-only and Workers Logs are free. Defer until launch signal justifies the complexity.

---

## Traceability

Each v1 requirement maps to exactly one phase. Coverage: 23/23 ✓.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUG-01 | Phase 1: Stabilize Backend & Observability | Complete |
| BUG-02 | Phase 1: Stabilize Backend & Observability | Complete |
| BUG-03 | Phase 1: Stabilize Backend & Observability | Complete |
| BUG-04 | Phase 1: Stabilize Backend & Observability | Complete |
| OBS-01 | Phase 1: Stabilize Backend & Observability | Pending |
| OPS-01 | Phase 1: Stabilize Backend & Observability | Pending |
| IDENT-01 | Phase 2: Real User Identity | Complete |
| IDENT-02 | Phase 2: Real User Identity | Complete |
| TIER-01 | Phase 3: Free/Plus Tier Redesign | Complete |
| TIER-02 | Phase 3: Free/Plus Tier Redesign | Complete |
| TIER-03 | Phase 3: Free/Plus Tier Redesign | Complete |
| TIER-04 | Phase 3: Free/Plus Tier Redesign | Complete |
| TIER-05 | Phase 3: Free/Plus Tier Redesign | Complete |
| TIER-06 | Phase 3: Free/Plus Tier Redesign | Complete |
| TIER-07 | Phase 3: Free/Plus Tier Redesign | Pending |
| TIER-08 | Phase 3: Free/Plus Tier Redesign | Complete |
| MEAS-01 | Phase 3 (retired post-launch) | Deferred |
| MEAS-02 | Phase 3 (retired post-launch) | Deferred |
| MEAS-03 | Phase 3 (retired post-launch) | Deferred |
| MEAS-04 | Phase 3 (retired post-launch) | Deferred |
| COLLAB-01 | Phase 4: Cross-User Collaboration | Pending |
| COLLAB-02 | Phase 4: Cross-User Collaboration | Pending |
| COLLAB-03 | Phase 4: Cross-User Collaboration | Pending |
| TOKEN-01 | Phase 5: Token Brokering MVP | Pending |
| TOKEN-02 | Phase 5: Token Brokering MVP | Pending |
| TOKEN-03 | Phase 5: Token Brokering MVP | Pending |
| TOKEN-04 | Phase 5: Token Brokering MVP | Pending |
| LAUNCH-01 | Phase 6: Waitlist Launch & Cold-Laptop Rehearsal | Pending |
| LAUNCH-02 | Phase 6: Waitlist Launch & Cold-Laptop Rehearsal | Pending |
| LAUNCH-03 | Phase 6: Waitlist Launch & Cold-Laptop Rehearsal | Pending |
| DOG-01 | Phase 7: Dogfood & Public Open | Pending |
