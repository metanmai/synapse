---
quick_id: 260530-wkg
description: BUGS.md #11 — incremental project-status recompute
date: 2026-05-30
status: in-progress
---

# Quick Task 260530-wkg: Incremental `recomputeProjectStatus`

**BUGS.md reference:** `docs/BUGS.md` §11 — "`recomputeProjectStatus` reads all events per batch"

## Problem

`backend/src/lib/handoff-reducer.ts:6-19` fetches the FULL event history for a project on every `/api/events/batch` POST, for every distinct `project_id` in the batch. Cost per flush cycle is `O(events_per_project)`. With the daemon's 10s flush cadence on an active project, this scales linearly in the cumulative event count — fine at 100 events, painful at 100k.

## Fix sketch

Maintain `ProjectStatus` incrementally — apply only the new events to the existing materialized status. The reducer is **structured as a left fold**, so this is feasible.

But three realities of the current reducer constrain the design:

1. **It pre-sorts by `occurred_at`** (clock-skew handling via `orderKey`). Naive append-only folding produces wrong order if late-arriving events have `occurred_at` earlier than already-processed events.

2. **The persisted `ProjectStatus` shape loses information.** Closed `Subtask`s and resolved `Issue`s are filtered out of the output. If a `SubtaskCompleted` or `IssueStateChanged` (especially a reopen) arrives later, incremental can't update what isn't in the persisted state.

3. **The current code's idempotency is load-bearing.** `events-batch.ts:124-128` comment explicitly relies on "the reducer is idempotent and the next batch will recompute from the now-stored events" to recover from a transient recompute failure. Going incremental breaks that recovery property unless an escape hatch bounds staleness.

## Solution

### 1. `applyEvents` in `packages/shared/src/handoff/reducer.ts`

```typescript
export function applyEvents(
  currentStatus: ProjectStatus,
  newEvents: Event[],
  opts: ReduceOptions = {},
): ProjectStatus | null
```

Returns `null` (signal: "fall back to full recompute") when:
- `newEvents` is empty → return currentStatus unchanged (no-op, NOT null)
- Any new event's `orderKey` is **strictly less than** the maximum `orderKey` in `currentStatus.recent_activity` (out-of-order arrival relative to current watermark)
- Any new event is `IssueStateChanged` targeting an issue that is NOT present in `currentStatus.open_issues.{decisions,questions}` AND is NOT created by an `IssueCreated` event earlier in `newEvents`

Otherwise:
- Sort `newEvents` by `orderKey` (same logic as `reduce`)
- Pre-load the actors map from `currentStatus.active_actors` (so existing actor state — `current_focus`, `branch`, `recent_files`, `last_event_at` — is preserved)
- Pre-load the subtasks map from `currentStatus.open_subtasks` (open ones only — closed ones are unreachable but also unmodifiable, which we've already guarded against)
- Pre-load the issues map from `currentStatus.open_issues.{decisions,questions}`
- Pre-seed `next_step` from `currentStatus.current_next_step`
- Apply each new event with the same switch statement as `reduce`
- Recompute `activity_state` for all actors against `now` (so idle→active and active→idle transitions are picked up even if no new events for that actor)
- Recompute `recent_activity` as `[...currentStatus.recent_activity, ...newEvents].sort(orderKey).slice(-50)`

### 2. `_meta` field on `ProjectStatus`

In `packages/shared/src/handoff/types.ts`:

```typescript
export interface ProjectStatus {
  // ... existing fields
  _meta?: {
    last_full_recompute_at: string;  // ISO 8601
  };
}
```

Optional, JSONB-friendly, no migration needed. Existing rows without it fall through to full recompute.

### 3. Backend `recomputeProjectStatus(db, project_id)` — signature unchanged

```typescript
const FULL_RECOMPUTE_INTERVAL_MS = 5 * 60 * 1000;

export async function recomputeProjectStatus(db, project_id) {
  // Read current status
  const { data: row } = await db
    .from("handoff_project_status").select("status").eq("project_id", project_id).maybeSingle();

  const currentStatus = (row?.status as ProjectStatus | undefined) ?? undefined;
  const lastFullAt = currentStatus?._meta?.last_full_recompute_at;
  const watermark = getWatermark(currentStatus);  // max orderKey in recent_activity, null if empty

  const canTryIncremental =
    currentStatus !== undefined &&
    lastFullAt !== undefined &&
    Date.now() - new Date(lastFullAt).getTime() < FULL_RECOMPUTE_INTERVAL_MS &&
    watermark !== null;

  if (canTryIncremental) {
    // Query only events strictly after watermark
    const { data: newRows } = await db
      .from("handoff_events").select("*").eq("project_id", project_id)
      .gt("occurred_at", watermark)
      .order("occurred_at", { ascending: true });

    const candidateEvents = (newRows ?? []).map(rowToEvent);

    // Dedup against existing recent_activity (events with same occurred_at as watermark
    // would have been excluded by `.gt`, but later-arriving events with identical
    // occurred_at as in recent_activity could appear — filter by event_id)
    const seenIds = new Set(currentStatus.recent_activity.map((e) => e.event_id));
    const newEvents = candidateEvents.filter((e) => !seenIds.has(e.event_id));

    const incremental = applyEvents(currentStatus, newEvents);
    if (incremental !== null) {
      await db.from("handoff_project_status").upsert({
        project_id,
        status: { ...incremental, _meta: currentStatus._meta },  // preserve last_full_recompute_at
        updated_at: new Date().toISOString(),
      });
      return;
    }
    // fall through to full recompute
  }

  // Full recompute path (unchanged behavior + stamps _meta)
  const { data: rows, error } = await db.from("handoff_events").select("*").eq("project_id", project_id).order("occurred_at", { ascending: true });
  if (error) throw error;
  const events: Event[] = (rows ?? []).map(rowToEvent);
  const status = reduce(events, project_id);
  const stamped: ProjectStatus = { ...status, _meta: { last_full_recompute_at: new Date().toISOString() } };
  await db.from("handoff_project_status").upsert({
    project_id,
    status: stamped,
    updated_at: new Date().toISOString(),
  });
}
```

### 4. Callers unchanged

`events-batch.ts:135` and `projects.ts:268` keep `recomputeProjectStatus(db, project_id)`. No coordination needed. `Promise.allSettled` error-isolation contract preserved.

## must_haves

- `applyEvents` exported from `packages/shared/src/handoff/reducer.ts`
- `applyEvents([], status)` → identity (returns the status unchanged)
- `applyEvents(status, newEvents)` returns `null` when out-of-order or `IssueStateChanged` on missing issue
- Property test: `reduce(all)` equivalent to `applyEvents(reduce(prefix), suffix)` for every split point, modulo `_meta`
- `ProjectStatus._meta?: { last_full_recompute_at: string }` field exists
- Backend `recomputeProjectStatus` signature unchanged
- All existing reducer tests still pass
- All backend tests still pass
- `npm run typecheck` clean
- `npm run lint` clean
- Atomic commit + push

## Tasks

1. `packages/shared/src/handoff/types.ts` — add `_meta` field
2. `packages/shared/src/handoff/reducer.ts` — add `applyEvents` (plus helpers `getWatermark`, `orderKey` export if needed)
3. `packages/shared/test/handoff/reducer.test.ts` — equivalence + safety-bail tests
4. `backend/src/lib/handoff-reducer.ts` — refactor `recomputeProjectStatus` with fast path
5. typecheck + lint + tests + commit + push

## Out of scope

- DB schema migrations (none needed — `_meta` rides inside JSONB)
- Endpoint changes (callers unchanged)
- Removing the `Promise.allSettled` defensive layer in `events-batch.ts`
- Integration tests on the live Supabase (gated on BUGS.md 5a)
- Performance benchmarks (qualitative win is obvious; rigorous bench needs production-shape data we don't have)
