# Roadmap — Stabilize-for-Launch Milestone

**Status as of 2026-05-30: SHIPPED.** Milestone close-out commit `f941dea` landed 2026-05-29 (on deadline). 3 of 7 phases shipped (Phases 1 slice 1a-prime, 2, 3 — with Phase 3 reshuffled from "Telemetry" to "Free/Plus Tier Redesign" mid-milestone). 4 phases deferred to v1.X. Post-launch v1.X work in progress: see "Post-launch v1.X" section at the bottom.

**Milestone:** Public launch with waitlist throttle by **Friday 2026-05-29** ✅
**Window:** 10 days (2026-05-19 → 2026-05-29), ~7 working days.
**Granularity:** Standard (7 phases for 23 v1 requirements).
**Mode:** MVP — every phase delivers an end-to-end user-observable slice, not a technical layer.
**Coverage:** 14/23 v1 requirements shipped; 9 deferred to v1.X with Phases 4-7.

---

## Phases

- [~] **Phase 1: Stabilize Backend & Observability** — 5/5 implementation plans complete; BUG-01..04 and BUGS-MD-12 shipped. OBS-01 awaits DSN/deploy/live delivery verification, and OPS-01 awaits a Paid-tier dashboard check.
- [x] **Phase 2: Real User Identity** — Events carry authenticated `user_id`; same-user cross-device sync works (`f941dea` verifies E2E 19/19)
- [x] **Phase 3: Free/Plus Tier Redesign** — *(scope swap from original "Telemetry"; original retired indefinitely.)* Shipped: 50-project cap, per-project conversation/insight LRU on Free, Plus Haiku consolidation, 3/10-device caps, manual `sync` CLI, and Plus-only project context. The planned tier-flip IPC became unnecessary when auto-sync was made available to every tier.
- [ ] **Phase 4: Cross-User Collaboration** — DEFERRED to v1.X. Owners invite teammates by email; invitees accept; briefs show per-actor view
- [ ] **Phase 5: Token Brokering MVP** — DEFERRED to v1.X. Plus subscribers opt-in to lend LLM tokens; one Synapse-internal call routes through the broker with attribution
- [ ] **Phase 6: Waitlist Launch & Cold-Laptop Rehearsal** — DEFERRED to v1.X. Public signup queues to waitlist; admin admits; fresh-laptop walkthrough documents and fixes friction
- [ ] **Phase 7: Dogfood & Public Open** — DEFERRED to v1.X. 3 consecutive days of personal Claude Code use captured + briefed + rated; waitlist flipped live

---

## Phase Details

### Phase 1: Stabilize Backend & Observability — ✅ SLICE 1A-PRIME SHIPPED (slice 1b deferred)
**Mode:** mvp
**Goal:** A user running the daemon can see their events reach the backend, and the operator can see future failures before users do.
**Depends on:** Nothing (entry phase). Unblocks every downstream phase.
**Requirements:** BUG-01, BUG-02, BUG-03, BUG-04, OBS-01, OPS-01
**Success Criteria** (what must be TRUE):
  1. Daemon-flushed events from a Claude Code session reach production and appear in the dashboard within one flush cycle, with zero Cloudflare 1101 errors over a 100-event / 3-project batch
  2. `synapse capture status` correctly reports "Daemon: running" with the launchd-supervised PID on macOS (and equivalent on systemd Linux if a machine is accessible)
  3. A fresh `synapse init` / wizard run on a proxy-restricted (Netskope) network produces a `.mcp.json` whose MCP server starts when Claude Code opens
  4. A deliberately-thrown unhandled rejection in `events-batch.ts` appears in Sentry within one minute with the real stack trace
  5. Production Worker is verified on the Paid tier before any further launch work begins (`wrangler whoami` + dashboard screenshot)
**Plans:** 5/5 implementation plans complete. External activation/verification remains for OBS-01 and OPS-01.
- [x] 01-01-wave0-scaffolding-PLAN.md — Wave 0 test scaffolding + production stubs (Wave 1)
- [x] 01-02-daemon-supervisor-backoff-PLAN.md — BUG-02 + BUGS.md #12 daemon supervisor + exponential backoff (Wave 2)
- [x] 01-03-mcp-command-resolver-PLAN.md — BUG-03 proxy-resilient MCP command resolver (Wave 2)
- [x] 01-04-init-writes-mcp-json-PLAN.md — BUG-04 `runInit` writes `.mcp.json` + ensures gitignore (Wave 2)
- [x] 01-05-sentry-observability-PLAN.md — Sentry SDK + first Hono middleware + privacy scrubber complete (`10.65.0`); DSN/deploy/deliberate-throw verification remains external

**Research status:** covered by `research/SUMMARY.md` (D1, D2, D9, D10, D11)
**UI hint**: no

### Phase 2: Real User Identity — ✅ SHIPPED
**Mode:** mvp
**Goal:** A signed-in user's events are attributable to their actual UUID, and that user can sign in on a second machine and see context from their first machine.
**Depends on:** Phase 1 (no point wiring identity through a broken pipe).
**Requirements:** IDENT-01, IDENT-02
**Success Criteria** (what must be TRUE):
  1. Events flushed by an authenticated daemon land in `handoff_events` with `actor_user_id` equal to the user's `public.users` UUID — no `"default"` rows after this phase
  2. On machine B (fresh install of the same authenticated user), `synapse init` + a Claude Code SessionStart for a project that already has events from machine A produces a brief that includes machine-A activity within one pull cycle
  3. Existing tests + e2e roundtrip (`mcp/scripts/test-cli-flow.mjs` or equivalent) pass against the real-user-id path; no regression in the placeholder `cwd_<hash>` auto-resolve flow
**Plans:** 6 plans
Plans:
- [x] 02-01-wave0-test-scaffolding-PLAN.md — Wave 0 RED test scaffolding for IDENT-01 + IDENT-02 (8 files: 2 NEW, 6 EXTEND)
- [x] 02-02-identity-bootstrap-PLAN.md — Slice A: D-01..D-05 — /api/account/me + init persists user_id + daemon reads from config
- [x] 02-03-device-origin-brief-PLAN.md — Slice D: D-09 — brief surfaces actor.hostname on cross-device same-user activity
- [x] 02-04-cross-device-link-PLAN.md — Slice B: D-06 + D-08 — migration 018 + git_remote_url matcher + eager pull (BLOCKING schema push)
- [x] 02-05-manual-link-ui-PLAN.md — Slice C: D-07 — merge_projects RPC + POST /api/projects/:id/merge-into/:target_id + LinkPicker.svelte
- [x] 02-06-playwright-e2e-PLAN.md — Wave 5: Playwright browser-driven e2e for LinkPicker (6 states, Chromium-only, mocked backend), wired into CI's existing e2e job
**Research needed:** yes — daemon currently emits `"default"` placeholder; need to study how `~/.synapse/config.json` is set vs. read, and what the cross-device sync flow looks like for events the daemon hasn't yet pulled. `/gsd:discuss-phase 2` should invoke a researcher before planning.
**UI hint**: no

### Phase 3: Free/Plus Tier Redesign ✅ SHIPPED
**Mode:** standard
**Goal:** Free tier is substantively usable for a solo user; Plus differentiates on per-project capacity, link sharing, and project context — not on project count or crash-safe continuity. Telemetry (the original Phase 3) is retired indefinitely; surface it later as a separate phase if user feedback warrants.
**Depends on:** Phase 2 (tier model + per-user identity already wired). Independent of Phase 4-7.
**Requirements:** TIER-01, TIER-02, TIER-03, TIER-04, TIER-05, TIER-06, TIER-07, TIER-08
**Success Criteria** (what must be TRUE):
  1. Free user can create 50 projects (same cap as Plus). 51st create attempt returns a structured `PROJECT_QUOTA_EXCEEDED` error rendered in the CLI sync flow, the browser UI, and the SessionStart brief's `## Sync error` section.
  2. Free user's 11th save into a project's insights silently evicts the oldest insight (by `updated_at`); same shape for 11th conversation save. Reads (GET) do NOT bump `updated_at`.
  3. Plus user's 51st insight save triggers async LLM consolidation via Haiku and `ctx.waitUntil` — produces 3-5 merged replacements with `supersedes` wired to the originals; on LLM failure the user is temporarily over-cap (no eviction) and a daily catchup retries.
  4. Free user limited to 3 devices; 4th `synapsesync init` from a new machine surfaces a sign-out picker listing existing devices. Re-init from the same machine returns the existing key (never creates a duplicate).
  5. Plus user limited to 10 devices with the same picker UX at cap.
  6. Every tier receives periodic daemon sync and hook-driven boundary pushes. `synapsesync sync` fires one cycle on demand with streaming progress lines + final summary, exit 0 on success / 1 on any step failure.
  7. Tier changes do not affect daemon continuity; the original tier-flip IPC criterion is superseded because there is no auto-sync gate to invalidate.
  8. Free user remains paywalled out of project context summaries; Plus user gets them automatically.
**Plans:** 5 plans complete; the original 03-05 tier gate was later superseded by the all-tier continuity decision.
- [x] 03-01-tier-constants-PLAN.md — Centralize per-tier capacity constants + accessors (`9e5bc88`)
- [x] 03-02-project-cap-PLAN.md — 50-project cap on both tiers + `PROJECT_QUOTA_EXCEEDED` (`8a5d134` backend → `d1aad53` CLI → `18762c7` UI → `822f393` + `88febad` tests)
- [x] 03-03-conversation-lru-PLAN.md — Per-project conversation LRU on Free (`7a42c6a`)
- [x] 03-04-insight-cap-PLAN.md — Per-project insight cap — Free LRU + Plus Haiku consolidation (`3f79efa`)
- [x] 03-05-manual-sync-device-cap-PLAN.md — Manual `sync` CLI + daemon tier-gate + 3/10-device picker + machine_id wiring (`35e0eb8` backend → `b5017af` MCP → `f88def0` wrap-up)
**Research status:** locked design decisions captured in CONTEXT.md; no separate research phase (mirrors existing tier.ts dual-surface pattern and compact.ts Haiku-call pattern)
**UI hint**: yes (device sign-out picker + settings device-list UI + quota error renderings)

### Phase 4: Cross-User Collaboration — DEFERRED to v1.X
**Mode:** mvp
**Goal:** A project owner can invite a teammate by email; the teammate accepts; subsequent briefs distinguish who-did-what across both users.
**Depends on:** Phase 2 (member-aware briefs require real `actor.user_id` on events; cross-user permissions require real identities).
**Requirements:** COLLAB-01, COLLAB-02, COLLAB-03
**Success Criteria** (what must be TRUE):
  1. From a project page in the dashboard, the owner can click "Invite", enter an email, and submit; a Supabase invite email arrives at that address and a `project_members` row appears in `pending` state
  2. The invited user signs in and sees an "Accept invite to <project>" prompt on the dashboard; accepting moves the `project_members` row to `accepted` and grants them read+write access to the project's events via RLS
  3. A project with events from User A AND User B produces a brief that distinguishes "A focused on X, B working on Y" (per-actor view from the reducer's existing `actors[]` grouping)
**Plans**: TBD
**Research needed:** yes — added after the 4-agent research wave. Backend invite endpoint exists (`POST /api/projects/:id/invites`) but the accept-flow UI, dashboard notification, and member-aware brief rendering need design study. `/gsd:discuss-phase 4` should invoke a researcher.
**UI hint**: yes

### Phase 5: Token Brokering MVP — DEFERRED to v1.X
**Mode:** mvp
**Goal:** A Plus subscriber can opt-in to lend their LLM tokens; at least ONE Synapse-internal call path actually routes through the broker against a pooled account, with usage attributed back to the lender, gated by an explicit ToS surface.
**Depends on:** Phase 2 (per-user encrypted credential storage requires real user identity + RLS).
**Requirements:** TOKEN-01, TOKEN-02, TOKEN-03, TOKEN-04
**Success Criteria** (what must be TRUE):
  1. A Plus user in account settings can toggle "Lend tokens to Synapse pool" on, enter their LLM provider key, and the key is stored in a `pool_credentials` table that no other user can read (RLS enforced + verified)
  2. ONE Synapse-internal LLM call (the heuristic-synth fallback OR brief LLM enhancement — whichever ships first) routed through the broker selects a pooled account, completes the call against that account's credentials, and writes a usage record with `(provider, account_id, tokens_in, tokens_out, timestamp)`; on a forced 429 the broker retries via the next account
  3. The lending user's account dashboard shows a list of "Calls routed through your tokens" with date, call type, and token counts — never the prompt or response content
  4. The Plus signup flow AND the lend-toggle surface both display a consent screen linking to a one-paragraph plain-English ToS section explaining the pool
**Plans**: TBD
**Research needed:** yes — added after the 4-agent research wave. Highest-risk item in the milestone (ToS / privacy / accounting surface). Open questions: which provider first (Anthropic? OpenAI? both?); how is "least-utilized" measured; what's the failover policy; what ToS language is legally defensible. `/gsd:discuss-phase 5` MUST invoke a researcher before any planning — flagged in `research/PITFALLS.md` as launch-slip candidate. MVP rule: ship ONE call path end-to-end; do NOT architect the complete broker.
**UI hint**: yes

### Phase 6: Waitlist Launch & Cold-Laptop Rehearsal — DEFERRED to v1.X
**Mode:** mvp
**Goal:** A stranger landing on synapsesync.app can sign up, be admitted by the operator, click the activation email, run the wizard, and see a working brief — every friction point identified and either fixed or documented.
**Depends on:** Phase 1 (Worker must be stable + on Paid tier). Independent of Phases 2-5; can run in parallel with them if attention permits, but the cold-laptop walk requires everything Phases 1-5 ship.
**Requirements:** LAUNCH-01, LAUNCH-02, LAUNCH-03
**Success Criteria** (what must be TRUE):
  1. A fresh email submitted to `synapsesync.app/signup` creates a `waitlist` row in `status: 'pending'`; no `auth.users` row is minted yet
  2. The operator hitting `POST /api/admin/waitlist/admit` (with `X-Admin-Secret`) for a pending email moves the row to `status: 'admitted'` AND the email recipient receives a usable Supabase invite activation link
  3. The four-stage funnel (signup-attempted, signup-queued, invite-sent, invite-clicked) is instrumented from day one — funnel-stage events visible per email
  4. The cold-laptop rehearsal is documented in `.planning/launch-rehearsal.md` with pass/fail per stage (signup → wait → admit → invite click → wizard → first brief), and every failed stage is either fixed in-milestone or filed as a launch-blocker bug
**Plans**: TBD
**Research status:** covered by `research/SUMMARY.md` (D7, D8, D11, D12, Q2, Q3) for LAUNCH-01/02; LAUNCH-03 is a rehearsal, not a build, so research not applicable.
**UI hint**: yes

### Phase 7: Dogfood & Public Open — DEFERRED to v1.X
**Mode:** mvp
**Goal:** Three consecutive days of the operator's own Claude Code use produces capture → flush → brief → rating with zero manual intervention, then the waitlist flips live.
**Depends on:** Phases 1-6 (everything else must be done; this phase has zero engineering scope by design).
**Requirements:** DOG-01
**Success Criteria** (what must be TRUE):
  1. `synapse capture status` shows ≥3 days of session events flushed, ≥1 brief rendered per day, with no manual `synapse` invocations beyond the `/synapse-rate` slash command
  2. Each of the 3 days produces at least one rated brief; rating-rate and time-to-context dashboard metrics from Phase 3 are populated and non-empty
  3. The waitlist signup form at `synapsesync.app/signup` is publicly reachable (link from landing page or direct URL) on launch day, accepting real signups
**Plans**: TBD
**Research status:** N/A — observation phase with no engineering scope. Per `research/PITFALLS.md` #5, any code change during Phase 7 is a scope-creep signal and goes to BUGS.md overflow.
**UI hint**: no

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Stabilize Backend & Observability | 5/5 | 🟡 Code complete; OBS-01 live check + OPS-01 tier check pending | 2026-05-19 → 2026-07-18 |
| 2. Real User Identity | 6/6 | ✅ SHIPPED | 2026-05-20 |
| 3. Free/Plus Tier Redesign *(swap from "Telemetry")* | 5/5 | ✅ SHIPPED | 2026-05-22 → 2026-05-29 |
| 4. Cross-User Collaboration | 0/0 | ⏳ DEFERRED to v1.X | - |
| 5. Token Brokering MVP | 0/0 | ⏳ DEFERRED to v1.X | - |
| 6. Waitlist Launch & Cold-Laptop Rehearsal | 0/0 | ⏳ DEFERRED to v1.X | - |
| 7. Dogfood & Public Open | 0/0 | ⏳ DEFERRED to v1.X | - |

**Total: 16 of 16 in-scope implementation plans code-complete (100%). 4 of 7 phases deferred to v1.X; 2 Phase 1 operational checks remain.**

---

## Dependency Graph

```
Phase 1 (Stabilize) ─┬─► Phase 2 (Identity) ─┬─► Phase 4 (Collab)  ─┐
                     │                       │                      │
                     │                       └─► Phase 5 (Tokens) ──┤
                     │                                              │
                     ├─► Phase 3 (Telemetry) ────────────────────────┤
                     │                                              │
                     └─► Phase 6 (Waitlist) ─────────────────────────┤
                                                                    │
                                                                    ▼
                                                              Phase 7 (Dogfood + Open)
```

**Parallelism windows** (where attention allows):
- Phase 3 (Telemetry), Phase 6 (Waitlist) can run in parallel with Phase 2 → 4 → 5 chain
- Phase 6 cold-laptop rehearsal MUST run after Phases 1-5 land
- Phase 7 is strictly last

**Critical path** (most likely to slip):
- Phase 1 (1101 root-cause is hypothesized but unverified)
- Phase 5 (Token brokering — ToS, privacy, accounting surface; flagged in PITFALLS.md as the launch-slip candidate)

---

## Coverage Summary

| Category | Reqs | Phase | Status |
|----------|------|-------|--------|
| Backend stabilization (BUG-01..04) | 4 | 1 | ✅ shipped |
| Observability (OBS-01) | 1 | 1 | 🟡 code complete; DSN/deploy/live event check pending |
| Workers tier (OPS-01) | 1 | 1 | ⏳ slice 1b deferred to v1.X |
| Identity (IDENT-01..02) | 2 | 2 | ✅ shipped |
| ~~Telemetry (MEAS-01..04)~~ | ~~4~~ | ~~3~~ | 🚫 retired — original Phase 3 scope swapped out 2026-05-22 |
| **Free/Plus Tier (TIER-01..08)** | **8** | **3 (swapped in)** | ✅ shipped; TIER-07 superseded |
| Collaboration (COLLAB-01..03) | 3 | 4 | ⏳ deferred to v1.X |
| Token brokering (TOKEN-01..04) | 4 | 5 | ⏳ deferred to v1.X |
| Public launch (LAUNCH-01..03) | 3 | 6 | ⏳ deferred to v1.X |
| Dogfood (DOG-01) | 1 | 7 | ⏳ deferred to v1.X |

**Shipped:** BUG-01..04, IDENT-01..02, and Phase 3's current tier behavior. TIER-07 is superseded by all-tier auto-sync. Sentry code is complete, but OBS-01 and OPS-01 remain open on external verification; Phases 4-7 are deferred.
**Deferred:** 11 product requirements across Phases 4-7; 2 Phase 1 operational checks remain.

---

## Research Status Per Phase

| Phase | Research |
|-------|----------|
| 1 | Covered by `research/SUMMARY.md` |
| 2 | Researched 2026-05-20 via `/gsd:discuss-phase 2`; verified shipped |
| 3 | Tier-redesign decisions captured in `phases/03-free-plus-tier-redesign/03-CONTEXT.md` (no separate research phase — mirrored existing `tier.ts` + `compact.ts` patterns) |
| 4 | **Pending v1.X** — `/gsd:discuss-phase 4` will invoke researcher when revived |
| 5 | **Pending v1.X** — `/gsd:discuss-phase 5` (HIGHEST RISK — ToS / privacy / accounting surface) |
| 6 | Covered by `research/SUMMARY.md` (deferred to v1.X) |
| 7 | N/A — observation phase |

---

## Post-launch v1.X (work in flight, outside original 7-phase plan)

### LLM API Proxy Daemon (Layers 1-9, shipped 2026-05-30)

Universal session capture via TLS-MITM forward proxy. Adapter-agnostic — works with any AI tool that honors `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` (claude CLI, codex, cursor, gemini, copilot CLI). Closes a gap the original 7-phase plan left open: capture only worked for tools that wrote session files Synapse could watch. The proxy makes Synapse capture-universal.

| Layer | Status | What it does |
|---|---|---|
| 1 | ✅ | Pure session reconstruction + endpoint allowlist |
| 2 | ✅ | HTTP forward-proxy + fake-LLM helper |
| 3a | ✅ | TLS Manager (CA + per-host leaves) |
| 3b | ✅ | CONNECT handler + TLS termination + cert isolation |
| 5 | ✅ | E2E with real `claude` CLI through TLS-MITM |
| 7 | ✅ | ProxySource wrapper + capture-worker integration |
| 8 | ✅ | CA install / status / uninstall CLI |
| 9 | ✅ | enable / disable + config-file activation |
| 4 | downgraded | SSE streaming UX (proven optional by Layer 5 — `clientRes.write(chunk)` already forwards live) |

**User-facing flow (three commands):**
```
synapsesync capture proxy install   # CA → login keychain + env snippet
# paste env snippet into ~/.zshrc
synapsesync capture proxy enable    # config + daemon restart
```

**Documentation:** `.planning/quick/20260530-proxy-*/` (per-layer PLAN + SUMMARY pairs).

### Pending v1.X follow-ups (smaller items)

- **P1 (BUGS.md) — COMPLETE 2026-07-18:** GitHub `prod` has all three migration secrets configured, and run `29649638136` attempt 2 reached `supabase db push`, reconciled the remote migration history, applied the outstanding migrations, and passed.
- **P2 (BUGS.md)** — Creem renewal webhook silent drop (defensive `default:` + proper event_type fix)
- **Insight action items** — orphan `owner_id` rows; `SessionStore` (source, id) keying refactor; bg-recompute POST `/compact` retry
- **Spike #118** — proxy validation against Cursor / Claude Desktop / ChatGPT Desktop (requires admin password for System keychain install)

---

*Created: 2026-05-19. Last refresh: 2026-05-30 — reflected milestone close-out + Phase 3 scope swap + Phase 4-7 deferral + post-launch proxy daemon. Source: PROJECT.md, REQUIREMENTS.md, research/SUMMARY.md, docs/BUGS.md, .planning/phases/, .planning/quick/, git log since 2026-05-19.*
