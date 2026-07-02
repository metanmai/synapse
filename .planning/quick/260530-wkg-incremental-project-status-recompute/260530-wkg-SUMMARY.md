---
quick_id: 260530-wkg
description: BUGS.md #11 — incremental project-status recompute
date: 2026-05-30
status: complete
---

# Summary — 260530-wkg

## What changed

1. **`packages/shared/src/handoff/types.ts`** — added optional `_meta?: { last_full_recompute_at: string }` to `ProjectStatus`. Optional field rides inside the existing JSONB column, so **no DB migration required**. Backward compatible — pre-existing rows without `_meta` fall through to the full-recompute path on first call after the change deploys.

2. **`packages/shared/src/handoff/reducer.ts`** — added `applyEvents(currentStatus, newEvents, opts) → ProjectStatus | null`. The function:
   - returns `null` (signal: "fall back to full recompute") when any new event's `orderKey` is strictly less than the maximum `orderKey` in `currentStatus.recent_activity` (out-of-order arrival)
   - returns `null` when any new event is `IssueStateChanged` targeting an issue not in `currentStatus.open_issues.{decisions,questions}` AND not being created by a paired `IssueCreated` event earlier in the same batch
   - otherwise pre-loads working state from the persisted `ProjectStatus` (actors, open subtasks, open issues, current next_step), applies the event-kind switch identically to `reduce`, recomputes `activity_state` against `now`, and merges/re-sorts/slice-50s the `recent_activity` array
   - empty `newEvents` returns a refreshed status (activity_state may still flip active→idle as time passes)

3. **`backend/src/lib/handoff-reducer.ts`** — refactored `recomputeProjectStatus(db, project_id)`. **Signature unchanged.** New behavior:
   - Read the current row from `handoff_project_status`
   - Try the incremental fast path when: status exists AND `_meta.last_full_recompute_at` exists AND was within last 5 min AND `recent_activity` has a watermark
   - Fast path queries only events with `occurred_at > watermark`, dedups by `event_id` against existing `recent_activity` (defensive against future `.gte` switches or retried upserts), and calls `applyEvents`
   - On `null` return OR any precondition failing, falls through to the full-recompute path (unchanged read pattern; stamps fresh `_meta.last_full_recompute_at`)

4. **`packages/shared/test/handoff/reducer.test.ts`** — added 8 tests for `applyEvents`:
   - **Property-style equivalence**: for a 15-event representative sequence, iterate every split point K (0..15) and assert `reduce(allEvents)` ≡ `applyEvents(reduce(events[0..K]), events[K..])`, modulo `updated_at` (now-dependent) and `_meta` (reducer-private)
   - Identity check on empty `newEvents`
   - Out-of-order bail returns `null`
   - `IssueStateChanged` on resolved/missing issue bails
   - `IssueStateChanged` on issue created in same batch is **safe** (no false-positive bail)
   - `recent_files` 10-cap preserved across split boundary
   - `recent_activity` 50-cap preserved across split when total exceeds 50
   - `_meta` carry-forward across incremental hop

## Why this matters

Previously `recomputeProjectStatus` was O(`events_per_project`) per flush cycle. The daemon flushes every 10s on active sessions, and `events-batch.ts` calls `recomputeProjectStatus` once per distinct `project_id` in each batch. At 100 events the cost was trivial; at 10k events it was already noticeable; at 100k+ (which active solo-developer sessions will reach within months) it would dominate request latency.

The new fast path is O(`events_since_last_recompute`), capped at 5-min intervals by the staleness escape. For a project with 50k cumulative events flushing every 10s, the fast path reads ~5-10 events instead of 50k.

## Safety properties preserved

The change preserves three load-bearing invariants from the previous code:

1. **Output equivalence** — pinned by the property-style equivalence test across every split point. Incremental output is observationally indistinguishable from full output for in-order event streams.

2. **Idempotency-on-failure** — previously guaranteed by "next batch re-reads all events." Now guaranteed by the 5-min escape: any transient recompute failure self-heals within at most 5 min of wall-clock time when the next call exceeds the interval and falls back to full recompute.

3. **Caller contract** — `recomputeProjectStatus(db, project_id)` signature unchanged. `events-batch.ts`'s `Promise.allSettled` error-isolation still works exactly as before. No coordination required at call sites.

## Tests

- `packages/shared/test/handoff/reducer.test.ts` — 15/15 pass (7 pre-existing + 8 new)
- backend full suite — 415/441 pass (26 skipped are pre-existing BUGS.md 5a Supabase-secret gating)
- full repo lint — clean for files I touched (1 pre-existing warning in mcp/test that I didn't touch)
- full repo typecheck — clean across backend, frontend, mcp, shared

## Out of scope

- DB schema migration (none needed — `_meta` rides inside JSONB)
- Endpoint or caller signature changes (deliberately untouched per task brief)
- Removing the defensive `Promise.allSettled` layer in `events-batch.ts` (it remains useful for the post-incremental error-isolation surface area)
- Integration tests on the live Supabase (gated on BUGS.md 5a)
- Performance benchmarks (qualitative win is structural; rigorous bench needs production-shape data we don't have)

## Followups

None blocking. The implementation is self-contained and the property-style equivalence test is the regression guard.
