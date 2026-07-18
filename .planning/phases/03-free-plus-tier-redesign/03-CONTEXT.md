# Phase 3: Free/Plus Tier Redesign — Context

**Gathered:** 2026-05-29
**Status:** Ready for planning
**Source:** Inline locked decisions captured during /gsd:plan-phase brainstorm (no separate /gsd:discuss-phase session). All design questions resolved by user.

> **Supersession note (2026-07-18):** The original Plus-only daemon auto-sync decision below was later reversed in `3776c154`. Crash-safe continuity now runs on every tier; tier-revision invalidation is unnecessary. The historical decisions remain below to explain the original plans.

<domain>
## Phase Boundary

Restructure the Free vs Plus tier model so that Free is substantively usable for a solo single-device developer, and Plus differentiates on per-project capacity, auto-sync continuity, link sharing, and project context summaries — not on project count.

In scope:
- Per-tier limits centralization (constants + accessors)
- 50-project cap on BOTH tiers (was per-tier different)
- Free per-project LRU eviction on insights and conversations
- Plus LLM-driven async insight consolidation at threshold
- Per-machine device identity + per-tier device cap (Free 3, Plus 10) with sign-out picker on overflow
- Free manual sync (`synapsesync sync` CLI) with daemon cycle gated; hooks still push inline
- Tier-flip IPC channel so post-upgrade auto-sync activation is seconds not minutes
- Frontend rendering for quota errors + device management UI
- Project context summaries remain Plus-only (existing gate preserved)

Out of scope:
- Per-tier insight cap visible in the SessionStart brief beyond the existing `MAX_INSIGHTS = 10` truncation (brief stays 10 for both tiers; difference is in stored count)
- Hard-deletion of grandfathered Plus users currently >50 projects (no such user exists per business confirmation)
- Resurfacing the original Phase 3 (Telemetry) work — retired indefinitely
- Multi-tier billing system changes (billing webhooks already wire to existing tier strings)
- New tier names beyond `free` and `plus`

</domain>

<decisions>
## Implementation Decisions

### Tier limits — locked numerical values
- `INSIGHTS_PER_PROJECT`: free=10, plus=50 (stored; brief truncation stays at 10 for both)
- `CONVERSATIONS_PER_PROJECT`: free=10, plus=50
- `PROJECTS_PER_USER`: free=50, plus=50 (hard cap both)
- `DEVICES_PER_USER`: free=3, plus=10
- `AUTO_SYNC`: free=false, plus=true (daemon cycle gating)
- All constants live in a single table in `backend/src/lib/tier.ts` with named accessors.

### Eviction semantics
- LRU key is `updated_at` (descending — newest first; oldest evicted).
- Reads (GET endpoints, MCP `list_insights`, MCP `read`) DO NOT bump `updated_at`. Only writes do (POST, PATCH, /compact server-side update).
- Eviction is SILENT — no warning, no toast, no pre-confirmation. The user does not see the evicted row again.
- Eviction is destructive: conversation row delete cascades to messages (verify FK `messages.conversation_id ON DELETE CASCADE` exists before relying on it; add migration if not).
- For Plus, eviction is REPLACED by LLM consolidation (see below).

### Plus LLM consolidation (Plus path, at 50-insight threshold)
- On `POST /api/insights` for a Plus user where active count would cross 50 AFTER insert: insert succeeds first; THEN fire `ctx.waitUntil(consolidateOldestInsights(projectId))` to run async without blocking the response.
- `consolidateOldestInsights()` lives in new file `backend/src/lib/llm/insight-consolidate.ts`, mirroring `backend/src/lib/llm/compact.ts` structure.
- Job: pull oldest 10 active insights by `updated_at ASC`, build a consolidation prompt asking Haiku to produce 3-5 merged replacements (each summary ≤12 words, detail ≤2 sentences), then call `createInsight()` for each replacement with `supersedes: [<all 10 original IDs>]`.
- Compensation on failure: log + skip eviction. User is temporarily over 50 active; the over-cap state is acceptable and self-corrects on the next overflow. ALSO: a daily cron-triggered job (Wrangler Cron Trigger) scans Plus projects with `>50 active insights` and retries consolidation for them — belt-and-suspenders against transient LLM outages.
- Model: `claude-haiku-4-5-20251001` (same as compact.ts).
- The new prompt builder lives in `backend/src/lib/llm/prompts.ts` next to the existing `buildAggregationPrompt()`.

### Project cap (hard, both tiers)
- Backend returns structured 402-style response: `{ error: "...", code: "PROJECT_QUOTA_EXCEEDED" }`.
- No grandfathering, no banner, no migration — business confirmed no current user has >50 projects.
- Shared projects (`role !== 'owner'`) do NOT count toward the 50 cap. Only owned projects count.
- Surfaced in three places: backend response body, CLI sync error rendering (in `synapsesync sync` output + daemon's `findOrCreateProjectByGit` failure path), browser UI on the "New project" action, AND a new `## Sync error` section in the SessionStart brief when an auto-create fails with this code.

### Device identity (solid detection)
- Per-machine UUID generated at first `synapsesync init` and persisted to `~/.synapse/device.json`. This UUID is the canonical device identity — survives hostname renames, user switches, laptop transfers (as long as `~/.synapse/` persists).
- Backend stores it in `device_keys.machine_id` column (new column or compatible re-use). UNIQUE constraint per `(user_id, machine_id)` so re-init from the same machine returns the existing key, never creates a duplicate.
- `hostname` is a separate display-only field, user-renamable.
- Edge case: if `~/.synapse/` is deleted, a fresh UUID is generated → appears as a new device. This is correct semantically (fresh install) but consumes a slot on the cap. Doctor command should warn on this state.

### Device cap with sign-out picker
- On `synapsesync init`: if user is at cap (3 for Free, 10 for Plus), backend returns 402 with `code: "DEVICE_CAP_EXCEEDED"` and a `devices: [{id, hostname, last_seen_at, registered_at}, ...]` payload.
- CLI init enters an arrow-key selector flow listing existing devices (hostname + last-seen + registered date).
- User picks one → CLI calls `DELETE /api/device-keys/<id>` → on success, retry the original init request.
- Cancellation: user can abort the picker — CLI exits with a clear "no device registered" message.
- Browser: dedicated device-management page in Settings shows the same device list with rename + sign-out buttons per row. Listed devices are the canonical source-of-truth UI.

### Sync model (Option B — pragmatic manual)
- Daemon's `cycle()` in `mcp/src/capture/daemon.ts` pre-checks user tier at the start of each cycle iteration. Tier is cached in-memory for 5 minutes by default; CACHE INVALIDATED IMMEDIATELY via an IPC channel when a tier-change event fires (post-purchase upgrade).
- If tier=free: skip the periodic flush + pull + handoff-prewarm cycle. Daemon stays alive but idle on the 5-min timer.
- If tier=plus: run the existing cycle unchanged.
- Hook-driven syncs (SessionEnd, PreCompact) still push inline regardless of tier — so single-device brief continuity works for Free users.
- New CLI command `synapsesync sync`: fires one cycle on demand regardless of tier. Useful as Free's primary sync mechanism + a debug tool for Plus.

### `synapsesync sync` output shape (streaming)
- Step lines stream as they happen:
  ```
  ▶ Reading local event queue... 12 events pending
  ▶ Pushing events to backend... done (12/12)
  ▶ Pulling handoff for project synapse... done (1 handoff)
  ▶ Pulling insights... done (8 insights cached)
  ✓ Synced in 1.4s
  ```
- Each step prints as it starts AND as it completes. Step failures print a clear error but the next step continues (best-effort sync).
- Exit code 0 on full success, 1 on any step failure. Failure mode shows which step failed at the end.

### Tier-change IPC channel
- Need a low-latency signal so a Free→Plus upgrade activates auto-sync without waiting 5 minutes for the next tier-cache refresh.
- Implementation: backend's billing webhook handler (or wherever `subscription.tier` flips) writes to a small status file in `~/.synapse/tier-changed.signal` via a return value carried back by the next hook invocation, OR uses a separate API endpoint `GET /api/me/tier-revision` polled briefly by the daemon when it has reason to suspect a change.
- Simpler proposal: piggyback on existing event POST responses. When the backend processes any inbound POST from a daemon, it can include a `tier_revision: <ts>` field in the response. Daemon compares to its cached revision; on mismatch, invalidates the tier cache. No new endpoint, no new file — uses existing response surface.
- Effective latency: as fast as the next event POST (typically seconds, not minutes).

### Project context summaries (existing Plus-only gate preserved)
- No change to existing gate in `frontend/src/routes/(app)/projects/[name]/context/+page.svelte` showing "Project context summaries are generated automatically on Plus" for Free users.
- The backend `aggregateProjectContext` flow continues running only for Plus users (existing tier check).
- This is the ONE remaining differentiator on the dashboard side that goes to Plus.

### Claude's Discretion
- Exact name of the `synapsesync sync` command and any aliases (`push`? `flush`? `pull`?)
- Internal naming of the IPC channel mechanism (HTTP-response piggyback proposed above is non-binding)
- The exact wording of CLI error messages and brief `## Sync error` section text
- Pattern for the tier-revision response field (string vs int vs timestamp)
- Whether to add observability metrics (counters for evictions, consolidation runs, cap hits) — non-blocking, can ship in a follow-up

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tier dispatch + enforcement (existing patterns to mirror)
- `backend/src/lib/tier.ts` — Dual-surface pattern (Context-flavored + tier-string-flavored helpers). New per-tier limit constants live here. ALL new helpers MUST follow the dual-surface pattern.
- `backend/src/lib/billing/*` — Where tier strings flip on subscription changes. The IPC channel hook lives somewhere in here.

### LLM consolidation mirror (Plus path)
- `backend/src/lib/llm/compact.ts` — Mirror for the new `insight-consolidate.ts`. Same shape: `getRecentX → buildXPrompt → AnthropicProvider.complete → save replacements`. The aggregation token cap (4096) and model (`claude-haiku-4-5-20251001`) are reusable.
- `backend/src/lib/llm/prompts.ts` — Where `buildAggregationPrompt()` lives. Add `buildInsightConsolidationPrompt()` next to it.

### Daemon + sync surface
- `mcp/src/capture/daemon.ts` — `cycle()` is where tier-gating goes. Tier cache lives here.
- `mcp/src/capture/handoff-sync.ts` — `findOrCreateProjectByGit` is where the 51st-project error surfaces in the daemon path.
- `mcp/src/capture/pull-insights.ts` — Brief insight pull (`MAX_INSIGHTS = 10`). No tier-conditional change needed here; both tiers see top-10 in brief.
- `mcp/src/cli/*` — New `synapsesync sync` CLI command lives here. Mirror the structure of existing CLI commands like `synapsesync doctor`.

### MCP servers (twin) — for any tool description changes
- `mcp/src/index.ts` — Local MCP server, used by Claude Code via `npx synapsesync`
- `backend/src/mcp/tools/insights.ts` — Remote MCP server, exposed at `synapsesync.app/mcp` for Claude.ai

### Frontend tier-gated surfaces
- `frontend/src/routes/(app)/projects/[name]/context/+page.svelte` — Existing Plus-only gate (preserved)
- `frontend/src/routes/(app)/projects/+page.svelte` (or equivalent) — New "New project" error rendering
- `frontend/src/routes/(app)/settings/...` — New device management UI

### Schema / migrations
- `supabase/migrations/` — Any new column (e.g. `device_keys.machine_id`) needs a migration. Check that `messages.conversation_id` already has `ON DELETE CASCADE` before relying on conversation eviction; add a migration if not.

### Existing codebase patterns
- `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/TESTING.md` — kept current by `/gsd-map-codebase`. Use these for any general codebase questions; do NOT re-research stack/architecture.

</canonical_refs>

<specifics>
## Specific Ideas

### File breakdown by slice (mirrors TaskList #105–#109)

**03-01 Tier constants centralization (prerequisite — blocks 02..05)**
- Modify: `backend/src/lib/tier.ts` — add TIER_LIMITS table + accessors
- Modify: `backend/test/lib/tier-enforce.test.ts` — add tests asserting accessor values
- No behavior change.

**03-02 50-project cap on both tiers**
- Modify: `backend/src/lib/tier.ts` — `enforceProjectQuotaForTier()` now hard-caps at 50 for both
- Modify: `backend/src/api/projects.ts` (or equivalent route) — return structured 402 with `PROJECT_QUOTA_EXCEEDED` code
- Modify: `frontend/src/routes/(app)/projects/+page.svelte` (or equivalent) — render error inline on new-project action
- Modify: `mcp/src/capture/handoff-sync.ts` — propagate quota error to CLI output
- Modify: `mcp/src/capture/pull-insights.ts` OR a new `pull-sync-errors.ts` — render `## Sync error` brief section when a recent quota error is cached locally
- New test: E2E for the bug class — N+K creates produce exactly N successes and K identical structured errors

**03-03 Free conversation LRU**
- Modify: `backend/src/api/conversations.ts` (POST handler) — pre-insert check + eviction for Free
- New helper: `backend/src/db/queries/conversations.ts` → `evictOldestConversationForProject(db, projectId)`
- Verify migration: `messages.conversation_id` has `ON DELETE CASCADE` (add migration if not)
- New unit test for the eviction helper
- New E2E asserting LRU class behavior (N+K saves, oldest K gone)

**03-04 Insight cap: Free LRU + Plus LLM consolidate**
- Modify: `backend/src/api/insights.ts` (POST handler) — tier-conditional pre-/post-insert logic
- New file: `backend/src/lib/llm/insight-consolidate.ts` — mirrors `compact.ts`
- Modify: `backend/src/lib/llm/prompts.ts` — add `buildInsightConsolidationPrompt()`
- New helper: `backend/src/db/queries/insights.ts` → `evictOldestInsightForProject(db, projectId)`, `getOldestActiveInsights(db, projectId, n)`
- New cron handler: `backend/src/cron/consolidate-overflowing-plus.ts` (Wrangler Cron Trigger, daily). Update `backend/wrangler.toml` with cron entry.
- New unit test for consolidation prompt + parsing
- New E2E for both Free LRU and Plus consolidation paths

**03-05 Manual sync + device cap + sign-out picker**
- Modify: `mcp/src/capture/daemon.ts` — tier cache, cycle gating, IPC revision check
- New CLI: `mcp/src/cli/sync.ts` — streaming-progress one-shot cycle
- Modify: `mcp/src/cli/init.ts` — device-cap detection + sign-out picker flow
- Schema migration: add `device_keys.machine_id` column with UNIQUE(user_id, machine_id)
- Modify: `mcp/src/cli/device-id.ts` (new) — UUID generation + `~/.synapse/device.json` persistence
- Modify: `backend/src/api/device-keys.ts` — return 402 with devices list at cap; allow re-init returning existing key
- New frontend: `frontend/src/routes/(app)/settings/devices/+page.svelte` — device management UI
- Backend response piggyback: add `tier_revision` field to common response surface
- New E2E: tier-flip in flight, 4th-device picker, re-init returns existing key (the "solid detection" guard)

### Wave structure (parallelization)
- Wave 0: 03-01 (constants — blocks everything)
- Wave 1: 03-02, 03-03 (independent — both can run after 03-01)
- Wave 2: 03-04 (insights — independent, but its E2E is heavier)
- Wave 3: 03-05 (daemon + CLI — biggest, ships last)

Each slice ships as its own commit chain through the merge gate (E2E + pre-push verify).

</specifics>

<deferred>
## Deferred Ideas

- **Telemetry (original Phase 3)** — retired indefinitely. Resurface as a separate phase if user feedback warrants metrics on brief quality / time-to-context.
- **Per-tier brief-truncation differentiation** — both tiers see top-10 insights in brief. If Plus users start asking for "all 50 visible," consider a separate per-tier `MAX_INSIGHTS_IN_BRIEF` constant in a later iteration.
- **Eviction warning UX** — silent eviction may surprise users who lose old conversations. Defer adding any pre-eviction warning until support burden demands it.
- **Cross-account sharing as a quota contributor** — non-owner shared projects currently don't count toward the 50-cap. If sharing usage skyrockets, revisit.
- **Tier-change webhook → daemon push notification** — current proposal piggybacks tier_revision on event POST responses. If daemons need true push (e.g., for users with no event activity), add a long-poll endpoint or WebSocket. Deferred until needed.
- **Observability counters** (evictions/sec, consolidation/sec, cap hits) — useful for tuning but non-blocking. Can ship as a small follow-up phase or be folded into a future telemetry phase.

</deferred>

---

*Phase: 03-free-plus-tier-redesign*
*Context gathered: 2026-05-29 via inline plan-phase brainstorm (all decisions locked by user before planning began)*
