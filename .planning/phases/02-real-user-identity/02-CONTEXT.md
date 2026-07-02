# Phase 2: Real User Identity - Context

**Gathered:** 2026-05-20
**Status:** Ready for research + planning

<domain>
## Phase Boundary

Phase 2 makes the daemon emit events carrying the real authenticated user UUID (not the `"default"` placeholder) AND makes the same user's signed-in second machine discover and pull existing projects from the first machine. Single-user, multi-device only — cross-user collaboration (different users with shared access) is explicitly **Phase 4** scope and not addressed here.

Roadmap-locked goal: *A signed-in user's events are attributable to their actual UUID, and that user can sign in on a second machine and see context from their first machine.*

Roadmap-locked success criteria (re-stated here for downstream agents):
1. Events flushed by an authenticated daemon land in `handoff_events` with `actor_user_id` equal to the user's `public.users` UUID — no `"default"` rows after this phase.
2. On machine B (fresh install, same authenticated user), `synapse init` + a Claude Code SessionStart for a project that already has events from machine A produces a brief that includes machine-A activity within one pull cycle.
3. No regression in the placeholder `cwd_<hash>` auto-resolve flow.

**Scope adjustment (vs. ROADMAP):** ROADMAP marks Phase 2 as `UI hint: no`. This discussion adds a small dashboard surface in Phase 2: a "merge into existing project" / "reassign" action on the project list, to manually override the auto-link's cross-device matching when it gets it wrong. Treated as part of how IDENT-02 is delivered reliably, not as net-new capability.

</domain>

<decisions>
## Implementation Decisions

### Identity bootstrap (daemon learns user UUID)

- **D-01:** `synapse init` is the bootstrap site. After receiving the `api_key`, init makes one server call to fetch the authenticated user's UUID + email and persists them into `~/.synapse/config.json` alongside `api_key`. UUID becomes part of the config file's contract.

- **D-02:** Endpoint shape is **Claude's discretion**. Recommended: a new single-purpose `GET /api/account/me` returning `{ user_id, email, tier }`. Rationale: matches the existing one-purpose-per-route convention in `backend/src/api/auth.ts:432-538` (keys list / create / revoke / rename / reset / delete are all single-purpose). Alternative considered: piggyback on `GET /api/account/keys` response — rejected for coupling reasons but planner may override if the round-trip savings matter.

- **D-03:** `mcp/src/cli/hook-dispatch.ts:59` is updated to read `user_id` from `~/.synapse/config.json` instead of `process.env.SYNAPSE_USER_ID ?? "default"`. `SYNAPSE_USER_ID` env override stays as a tier-2 fallback for tests / debugging. From this commit forward, new local `events.jsonl` rows carry the real UUID.

- **D-04:** No backfill of existing `"default"` rows in local `events.jsonl`. Rationale: backend's auth-override at `backend/src/api/events-batch.ts:60` already makes prod rows correct regardless of what the local jsonl carries. Old local rows naturally roll over on flush. Forward-only write keeps the change atomic.

- **D-05:** **Fail-fast on init.** If `GET /api/account/me` fails (offline, Netskope-blocked, transient network, bad api_key), `synapse init` aborts with a clear error and does NOT write a half-configured `config.json`. User must fix the network/auth and re-run. Rationale: clean state always; no in-between states the daemon has to handle.

### Cross-device project discovery (same user, multi-device)

- **D-06:** **Linking signal is git remote URL with basename fallback.** Daemon reads `git remote get-url origin` for the event's cwd; backend matches by `(user_id, git_remote_url)` first, falls back to `(user_id, git_basename)` for non-git folders or repos without a remote. New column `git_remote_url` on the appropriate table (planner decides: `projects`, `handoff_project_status`, or a new lookup table). Index it for the lookup hot path.

- **D-07:** **Manual override UI lands in Phase 2.** Dashboard project list gets a small action — "merge into existing project" or "reassign" — with a confirmation modal that lists candidate projects. Used when auto-link gets the cross-device match wrong (e.g., user wants to manually unify two separately-auto-created projects, or split one project into two). Scope: one button + one modal + one backend endpoint to perform the merge. Crosses the original `UI hint: no` line; treated as the minimum UI needed to make IDENT-02 reliable.

- **D-08:** **Eager full sync on link.** When the backend establishes a link between machine B's local project and an existing canonical project, the daemon performs a one-shot pull of:
  - `ProjectStatus` (the reduced state)
  - The last N events (N = Claude's discretion; suggest 500 as a starting point — sized so the brief renderer has enough context for "recent activity" lookups without ballooning local disk)

  Subsequent pulls are normal incremental cycles. Local jsonl gets the pulled events appended (with a marker distinguishing "pulled from backend" vs "captured locally" so the watermark logic doesn't double-flush — planner detail).

- **D-09:** **Brief surfaces device origin explicitly.** When the brief renderer sees that the most-recent activity came from an actor with a different `device_id` than the local one, it prepends the device name: "Most recent activity (on MacBook Pro): synapse-mcp on main". `<device-name>` comes from the per-device CLI key label (`cli-<device>` from the existing per-device-keys feature, shipped at commit `46bdabb`). Planner decides the lookup mechanism: device-name column on event payload, sidecar `devices` table, or join via `api_keys`.

### Claude's Discretion

- **D-02** endpoint shape — recommend new `GET /api/account/me` per the single-purpose convention; planner may pick the alternative.
- **D-08** N for "last N events" on eager sync — suggest 500 events; planner decides based on storage / network budget. Consider making it configurable in `~/.synapse/config.json` (`backfill_events_limit`).
- **Test coverage:** standard behavioral tests per `feedback_test_generality.md` — guard the bug class (UUID-from-config, link-by-git-remote, eager-sync-on-link, device-name-in-brief), not specific strings.
- **File organization:** identity-side helpers go in `mcp/src/capture/` (alongside `actor.ts`); new backend endpoints in `backend/src/api/auth.ts` and `backend/src/api/projects.ts`; new migration is `supabase/migrations/018_*.sql` (next sequential number after `017_project_invites.sql`).
- **Concurrency / throttle** of eager sync at init time — single-threaded sequential pull is fine for the expected N ≤ ~10 projects per user. Don't over-engineer.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

### Project + roadmap context
- `.planning/PROJECT.md` — milestone scope, constraints
- `.planning/REQUIREMENTS.md` §IDENT-01, §IDENT-02 — acceptance criteria
- `.planning/ROADMAP.md` §"Phase 2: Real User Identity" — success criteria + dependency notes (Phase 2 depends on Phase 1; Phase 4 + Phase 5 depend on Phase 2)
- `.planning/STATE.md` — current position; Phase 1 slice 1a-prime shipped

### Codebase maps (read before research)
- `.planning/codebase/INTEGRATIONS.md` §"Authentication & Identity" — Supabase Auth + API-key path, auth middleware contract, `c.var.user.id` source of truth
- `.planning/codebase/ARCHITECTURE.md` — overall system shape; handoff event flow
- `.planning/codebase/CONVENTIONS.md` — TypeScript / testing / module patterns

### Daemon-side identity surface
- `mcp/src/capture/actor.ts` — `resolveActor(user_id, kind)`; takes user_id as argument; device_id is local-stable
- `mcp/src/cli/hook-dispatch.ts:59` — current `SYNAPSE_USER_ID ?? "default"` source; **fix site for D-03**
- `mcp/src/cli/init.ts:126-132` — config.json writer; **add user_id field after /me call (D-01)**
- `mcp/src/capture/cloud-sync.ts:19-44` — `SYNAPSE_API_KEY` resolver; reference for env precedence
- `mcp/src/capture/handoff-paths.ts` — `synapseRoot()` + config paths

### Backend identity surface
- `backend/src/lib/auth.ts:31-94` — auth middleware; sets `c.var.user`, source-of-truth for UUID
- `backend/src/api/auth.ts:432-538` — account routes; **new `GET /api/account/me` lands here (D-02)**
- `backend/src/api/events-batch.ts:60` — existing `actor_user_id: user.id` override (don't break this)

### Cross-device discovery surface
- `backend/src/api/events-batch.ts:71-121` — current cwd_hash → canonical auto-create flow + project_members membership check; **the matching site for D-06**
- `backend/src/api/project-status.ts` — `GET /api/projects/:id/status`; used by eager-pull on link
- `backend/src/api/projects.ts` — projects list endpoint (existing or to-be-added; planner confirms)
- `backend/src/lib/handoff-reducer.ts` — folds events into ProjectStatus (idempotent, deterministic; ensures concurrent activity on both machines produces merged state on next pull — no per-device conflict resolution needed)
- `mcp/src/capture/handoff-sync.ts` — daemon flush + pull cycle (eager-sync triggers here on D-08)

### Brief renderer surface (D-09)
- `mcp/src/capture/handoff-brief.ts:17-61` — `render()` and the "Your last activity" branch; **D-09 fix site**
- `mcp/src/hooks/session-start.ts:21-27` — emits brief (with STATE.md fallback per commit `d61857b`)

### Per-device CLI keys (already shipped; D-09 needs device-name lookup)
- `backend/src/api/auth.ts:142` — API key creation with label (`cli-<device>` convention)
- Memory: `project_per_device_keys_status.md` — feature shipped end-to-end at commit `46bdabb`; backend/CLI/frontend wire done; UX bits like 409 device picker still pending (BUGS.md #5 — out of scope here)

### Schema
- `supabase/migrations/015_handoff_layer.sql` — `handoff_events` + `handoff_project_status` schema
- `supabase/migrations/017_project_invites.sql` — most recent migration; next is `018_*`
- Planner authors `supabase/migrations/018_*.sql` for the `git_remote_url` column (D-06)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Auth middleware (`backend/src/lib/auth.ts`)** — JWT and API-key paths both set `c.var.user` with the resolved `public.users` row. The new `GET /api/account/me` (D-02) just reads that and returns the relevant subset. ~10 LOC of new route.
- **Existing per-device CLI keys** (commit `46bdabb`) — keys are labeled `cli-<device-name>`. D-09's device-name surface piggybacks on this convention.
- **Backend cwd_hash → canonical resolver** (`events-batch.ts:71-121`) — already matches by `(user_id, name)` for membership. D-06 extends this with a `git_remote_url` lookup before the name fallback.
- **Reducer at `backend/src/lib/handoff-reducer.ts`** — deterministic fold of events into ProjectStatus. Concurrent multi-device activity automatically merges; no conflict resolution code needed.

### Established Patterns

- **TypeScript across all 4 workspaces** — no language switches.
- **Solo dev, no external users** — clean slate over backwards-compat (`feedback_no_other_users.md`).
- **Tests guard bug class, not instance** (`feedback_test_generality.md`) — D-09 tests assert "brief includes device origin when actor.device_id ≠ local", not a specific string.
- **Inline execution** (`feedback_user_driven_execution.md`) — execute plans via Write/Edit/Bash, not gsd-executor subagent dispatch.
- **Pre-push hook runs `lint && typecheck && test`** — ~25s per push. Keep tasks small enough that the hook isn't punishing.
- **`synapse init` is idempotent** for hooks + commands — re-runs don't duplicate (`mcp/src/cli/init.ts:95, 112-117`). Adding the `/me` call must preserve this idempotence.

### Integration Points

- **`synapse init` is called from both wizard and direct CLI** (per Phase 1 D-01 context). The new `/me` call must work in both contexts. Wizard path is already authenticated by that stage (api_key has been minted); direct-CLI path with `--api-key` is also authenticated.
- **Daemon flush at `mcp/src/capture/handoff-sync.ts`** sends batches to `/api/events/batch`. The first flush from a fresh machine B triggers the auto-create / link match. D-08's eager pull runs AFTER the first flush returns, using the resolved canonical project_id.
- **Brief cache at `~/.synapse/projects/<id>/cache/brief.md`** — written by daemon's pull cycle. SessionStart hook reads it (with STATE.md fallback per `d61857b`). D-09's device-aware rendering happens in the daemon's `writeBrief` path (server-rendered) OR in the SessionStart hook (client-rendered). Planner decides — server-rendered is cleaner since the renderer already lives in `mcp/src/capture/handoff-brief.ts` and needs the actor lookup anyway.

</code_context>

<specifics>
## Specific Ideas

- **`git remote get-url origin` resolution:** capture at hook time (when the event is appended) rather than at flush time. Cache per-cwd so we don't shell out on every event. Falls back to `git_basename` when not in a git repo or no remote is set.
- **Manual-override UI surface:** project list page in the existing dashboard. One inline action per project: "Merge into…" → modal with searchable dropdown of the user's other projects + a confirmation. The merge endpoint reassigns events from the source project_id to the target, then deletes the source row.
- **Brief device-origin format:** `Most recent activity (on <device-name>): <focus> on <branch>` when device_id differs from local; `Your last activity: <focus> on <branch>` when same-device (today's wording, preserved).
- **Eager-sync watermark coordination:** when the daemon pulls events on link, it must advance `.watermark` to the highest pulled event_id so it doesn't try to flush them back. Or distinguish "pulled" vs "captured" in the local jsonl. Planner decides.
- **Multi-key per user (capped at 10):** D-09 device-name lookup needs to handle the rename case (`cli-laptop-old` → `cli-laptop-new`). Pull device-name freshly each pull cycle, don't cache aggressively.

</specifics>

<deferred>
## Deferred Ideas

### Phase 4 (Cross-User Collaboration)
- Different user with access to the same project (forked / shared / invited). The "user 2 has a fork of user 1's project with write access" scenario the user surfaced — explicitly Phase 4, not Phase 2.
- Member-aware briefs that distinguish "User A focused on X, User B working on Y" — Phase 4 SC #3.
- Cross-user permission boundaries on the manual-override / merge UI.

### Other phases or follow-ups
- **Key-invalidation / 401 recovery** (not selected as a Phase 2 gray area) — when the daemon's api_key gets rotated or revoked, it currently keeps flushing into a 401 wall. Revisit if dogfood / cold-laptop rehearsal surfaces re-auth pain.
- **Per-project sync opt-out** — flag projects as "this machine only, don't sync to other devices" for host-specific work (secrets, scratchpads). Not surfaced as a real need yet. Revisit if dogfood demands it.
- **First-brief-on-machine-B explicit behavior** (deferred gray area) — substantially subsumed by D-08's eager full sync on link; first brief is populated as soon as link is established, and falls back to STATE.md (per `d61857b`) when no link exists yet.
- **N for "last N events" sizing** — start at 500; tune based on dogfood storage / network observations.
- **Eager-sync throttle / parallelism** — single-threaded sequential is fine at the expected scale; revisit if a user with 50+ projects appears.

</deferred>

---

*Phase: 02-real-user-identity*
*Context gathered: 2026-05-20*
*Note: Phase 2 needs research per ROADMAP.md ("**Research needed:** yes — daemon currently emits 'default' placeholder; need to study how `~/.synapse/config.json` is set vs. read, and what the cross-device sync flow looks like for events the daemon hasn't yet pulled"). `/gsd:plan-phase 2` will invoke `gsd-phase-researcher` before the planner runs.*
