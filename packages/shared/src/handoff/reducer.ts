import { EventKind } from "./events.js";
import type { Actor, Event, FileTouch, Issue, ProjectStatus, Subtask } from "./types.js";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 50;

export interface ReduceOptions {
  now?: Date;
}

export function reduce(events: Event[], project_id: string, opts: ReduceOptions = {}): ProjectStatus {
  const now = (opts.now ?? new Date()).toISOString();
  // Order by occurred_at (LWW), fall back to received_at if occurred_at is implausible (>5 min in future of now).
  const nowMs = new Date(now).getTime();
  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ka = orderKey(a.e, nowMs);
      const kb = orderKey(b.e, nowMs);
      return ka < kb ? -1 : ka > kb ? 1 : a.i - b.i;
    })
    .map(({ e }) => e);

  let next_step: ProjectStatus["current_next_step"] = null;
  const actors = new Map<string, ProjectStatus["active_actors"][number]>();
  const recent = ordered.slice(-RECENT_ACTIVITY_LIMIT);
  const subtasks = new Map<string, Subtask>();
  const issues = new Map<string, Issue>();

  for (const e of ordered) {
    const aKey = e.actor.user_id;
    const slot = actors.get(aKey) ?? {
      actor: e.actor,
      current_focus: null,
      branch: null,
      last_event_at: e.occurred_at,
      activity_state: "active" as const,
      recent_files: [] as FileTouch[],
    };
    slot.last_event_at = e.occurred_at;

    switch (e.kind) {
      case EventKind.NextStepSet:
        next_step = { text: String(e.payload.text ?? ""), set_by: e.actor, set_at: e.occurred_at, inferred: false };
        break;
      case EventKind.NextStepInferred: {
        const m = (e.payload as { inferred_method?: unknown }).inferred_method;
        const inferred_method = m === "llm" || m === "heuristic" ? m : undefined;
        next_step = {
          text: String(e.payload.text ?? ""),
          set_by: e.actor,
          set_at: e.occurred_at,
          inferred: true,
          ...(inferred_method ? { inferred_method } : {}),
        };
        break;
      }
      case EventKind.FocusSet:
        slot.current_focus = String(e.payload.text ?? "");
        break;
      case EventKind.UserPrompted:
        if (!slot.current_focus) {
          slot.current_focus = String(e.payload.prompt_excerpt ?? "").slice(0, 80);
        }
        break;
      case EventKind.BranchSwitched:
        slot.branch = String(e.payload.branch ?? slot.branch);
        break;
      case EventKind.FileTouched: {
        const f: FileTouch = {
          path: String(e.payload.path),
          last_touched_at: e.occurred_at,
          operation: (e.payload.operation as FileTouch["operation"]) ?? "edit",
        };
        slot.recent_files = [f, ...slot.recent_files.filter((x) => x.path !== f.path)].slice(0, 10);
        break;
      }
      case EventKind.SubtaskAdded: {
        const p = e.payload as { task_id?: string; text?: string };
        const id = String(p.task_id ?? e.event_id);
        subtasks.set(id, {
          id,
          text: String(p.text ?? ""),
          state: "open",
          parent: { type: "session", id: e.session_id },
          done_at: null,
          done_by: null,
        });
        break;
      }
      case EventKind.SubtaskCompleted: {
        const p = e.payload as { task_id?: string };
        const id = String(p.task_id);
        const t = subtasks.get(id);
        if (t) {
          t.state = "done";
          t.done_at = e.occurred_at;
          t.done_by = e.actor;
        }
        break;
      }
      case EventKind.IssueCreated: {
        const p = e.payload as {
          id: string;
          number: number;
          kind: "decision" | "question";
          title: string;
          body?: string;
        };
        issues.set(p.id, {
          id: p.id,
          number: p.number,
          type: "issue",
          kind: p.kind,
          state: "open",
          title: p.title,
          body: p.body ?? "",
          author: e.actor,
          assignees: [],
          labels: [],
          references: [],
          timeline: [],
          created_at: e.occurred_at,
          updated_at: e.occurred_at,
          closed_at: null,
          superseded_by: null,
          resolved_by: null,
          originated_in_session: { type: "session", id: e.session_id },
        });
        break;
      }
      case EventKind.IssueStateChanged: {
        const p = e.payload as { id: string; state: "open" | "resolved" | "superseded"; superseded_by?: string };
        const it = issues.get(p.id);
        if (it) {
          it.state = p.state;
          it.updated_at = e.occurred_at;
          if (p.state === "resolved") it.resolved_by = e.actor;
          if (p.state === "superseded" && p.superseded_by) it.superseded_by = { type: "issue", id: p.superseded_by };
        }
        break;
      }
    }
    actors.set(aKey, slot);
  }

  for (const slot of actors.values()) {
    slot.activity_state = nowMs - new Date(slot.last_event_at).getTime() > IDLE_THRESHOLD_MS ? "idle" : "active";
  }

  return {
    project_id,
    current_next_step: next_step,
    active_actors: [...actors.values()].sort((a, b) => b.last_event_at.localeCompare(a.last_event_at)),
    recent_activity: recent,
    open_issues: {
      decisions: [...issues.values()].filter((i) => i.kind === "decision" && i.state === "open"),
      questions: [...issues.values()].filter((i) => i.kind === "question" && i.state === "open"),
    },
    open_subtasks: [...subtasks.values()].filter((t) => t.state === "open"),
    updated_at: now,
  };
}

function orderKey(e: Event, nowMs: number): string {
  // Use received_at when occurred_at is implausibly far in the future relative to now (clock skew guard).
  const occMs = new Date(e.occurred_at).getTime();
  if (occMs - nowMs > 5 * 60 * 1000) return e.received_at;
  return e.occurred_at;
}

/**
 * Incremental sibling of `reduce` (BUGS.md #11). Folds `newEvents` into the
 * existing materialized `currentStatus` so the caller can avoid re-reading the
 * full event history on every batch.
 *
 * Returns `null` when the incremental fold would diverge from a full
 * `reduce(allEvents)` — the caller must fall back to a full recompute in that
 * case. There are two such "unsafe" conditions:
 *
 *   1. Out-of-order arrival — any new event's `orderKey` is strictly less than
 *      the maximum `orderKey` in `currentStatus.recent_activity`. The current
 *      reducer pre-sorts before folding, so a late-arriving older event would
 *      need to be inserted INTO the timeline (not appended). The persisted
 *      status doesn't carry enough information (e.g. dropped resolved issues,
 *      LWW for next_step pivoting on it) to do that safely.
 *
 *   2. `IssueStateChanged` targeting an issue that's neither in the current
 *      `open_issues` nor being `IssueCreated` in this same batch. The full
 *      `reduce` would still find the issue in its internal map (since closed
 *      issues stay in the map until the final filter), but our persisted
 *      output dropped it — we'd silently no-op a real state transition (e.g.
 *      a reopen).
 *
 * Empty `newEvents` returns a shallow copy of `currentStatus` so callers can
 * treat the return as "new status to persist" uniformly.
 */
export function applyEvents(
  currentStatus: ProjectStatus,
  newEvents: Event[],
  opts: ReduceOptions = {},
): ProjectStatus | null {
  const now = (opts.now ?? new Date()).toISOString();
  const nowMs = new Date(now).getTime();

  // No new events — return current status with refreshed `updated_at` + activity_state recompute.
  // We still re-evaluate idleness because time-since-last-event has advanced.
  if (newEvents.length === 0) {
    return refreshActivityStates(currentStatus, nowMs, now);
  }

  // Watermark: max orderKey across the existing recent_activity. If
  // recent_activity is empty (fresh project) we have no watermark, and the
  // out-of-order safety check vacuously passes.
  const existingRecent = currentStatus.recent_activity ?? [];
  let watermark: string | null = null;
  for (const e of existingRecent) {
    const k = orderKey(e, nowMs);
    if (watermark === null || k > watermark) watermark = k;
  }

  // Sort new events by orderKey (mirrors the same logic as `reduce`).
  const orderedNew = newEvents
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ka = orderKey(a.e, nowMs);
      const kb = orderKey(b.e, nowMs);
      return ka < kb ? -1 : ka > kb ? 1 : a.i - b.i;
    })
    .map(({ e }) => e);

  // Safety check 1: out-of-order detection.
  if (watermark !== null) {
    for (const e of orderedNew) {
      if (orderKey(e, nowMs) < watermark) return null;
    }
  }

  // Pre-scan: which issue ids does this batch CREATE? We allow IssueStateChanged
  // on those even if they're not in currentStatus.open_issues.
  const createdInBatch = new Set<string>();
  for (const e of orderedNew) {
    if (e.kind === EventKind.IssueCreated) {
      const p = e.payload as { id?: unknown };
      if (typeof p.id === "string") createdInBatch.add(p.id);
    }
  }

  // Pre-scan: open issue ids already in currentStatus.
  const openIssueIds = new Set<string>([
    ...currentStatus.open_issues.decisions.map((i) => i.id),
    ...currentStatus.open_issues.questions.map((i) => i.id),
  ]);

  // Safety check 2: IssueStateChanged on missing+uncreated issue.
  for (const e of orderedNew) {
    if (e.kind === EventKind.IssueStateChanged) {
      const p = e.payload as { id?: unknown };
      if (typeof p.id !== "string") continue;
      if (!openIssueIds.has(p.id) && !createdInBatch.has(p.id)) return null;
    }
  }

  // Pre-load mutable working state from currentStatus.
  // - next_step: starting point (newer NextStepSet/Inferred events will overwrite)
  // - actors: keyed by user_id, carrying current_focus/branch/last_event_at/recent_files
  // - subtasks: only OPEN ones (closed are unreachable for further state transitions
  //             but their absence is harmless — final filter still excludes them)
  // - issues: only OPEN ones (same reasoning; the safety check above rejects
  //           reopen-style transitions where we'd need to resurrect a dropped issue)
  let next_step: ProjectStatus["current_next_step"] = currentStatus.current_next_step
    ? { ...currentStatus.current_next_step }
    : null;

  const actors = new Map<string, ProjectStatus["active_actors"][number]>();
  for (const a of currentStatus.active_actors) {
    actors.set(a.actor.user_id, {
      actor: a.actor,
      current_focus: a.current_focus,
      branch: a.branch,
      last_event_at: a.last_event_at,
      activity_state: a.activity_state,
      recent_files: [...a.recent_files],
    });
  }

  const subtasks = new Map<string, Subtask>();
  for (const t of currentStatus.open_subtasks) {
    subtasks.set(t.id, { ...t });
  }

  const issues = new Map<string, Issue>();
  for (const i of [...currentStatus.open_issues.decisions, ...currentStatus.open_issues.questions]) {
    issues.set(i.id, { ...i });
  }

  // Per-event application (mirrors the switch in `reduce`).
  for (const e of orderedNew) {
    const aKey = e.actor.user_id;
    const slot =
      actors.get(aKey) ??
      ({
        actor: e.actor,
        current_focus: null,
        branch: null,
        last_event_at: e.occurred_at,
        activity_state: "active",
        recent_files: [] as FileTouch[],
      } as ProjectStatus["active_actors"][number]);
    slot.last_event_at = e.occurred_at;

    switch (e.kind) {
      case EventKind.NextStepSet:
        next_step = { text: String(e.payload.text ?? ""), set_by: e.actor, set_at: e.occurred_at, inferred: false };
        break;
      case EventKind.NextStepInferred: {
        const m = (e.payload as { inferred_method?: unknown }).inferred_method;
        const inferred_method = m === "llm" || m === "heuristic" ? m : undefined;
        next_step = {
          text: String(e.payload.text ?? ""),
          set_by: e.actor,
          set_at: e.occurred_at,
          inferred: true,
          ...(inferred_method ? { inferred_method } : {}),
        };
        break;
      }
      case EventKind.FocusSet:
        slot.current_focus = String(e.payload.text ?? "");
        break;
      case EventKind.UserPrompted:
        if (!slot.current_focus) {
          slot.current_focus = String(e.payload.prompt_excerpt ?? "").slice(0, 80);
        }
        break;
      case EventKind.BranchSwitched:
        slot.branch = String(e.payload.branch ?? slot.branch);
        break;
      case EventKind.FileTouched: {
        const f: FileTouch = {
          path: String(e.payload.path),
          last_touched_at: e.occurred_at,
          operation: (e.payload.operation as FileTouch["operation"]) ?? "edit",
        };
        slot.recent_files = [f, ...slot.recent_files.filter((x) => x.path !== f.path)].slice(0, 10);
        break;
      }
      case EventKind.SubtaskAdded: {
        const p = e.payload as { task_id?: string; text?: string };
        const id = String(p.task_id ?? e.event_id);
        subtasks.set(id, {
          id,
          text: String(p.text ?? ""),
          state: "open",
          parent: { type: "session", id: e.session_id },
          done_at: null,
          done_by: null,
        });
        break;
      }
      case EventKind.SubtaskCompleted: {
        const p = e.payload as { task_id?: string };
        const id = String(p.task_id);
        const t = subtasks.get(id);
        if (t) {
          t.state = "done";
          t.done_at = e.occurred_at;
          t.done_by = e.actor;
        }
        break;
      }
      case EventKind.IssueCreated: {
        const p = e.payload as {
          id: string;
          number: number;
          kind: "decision" | "question";
          title: string;
          body?: string;
        };
        issues.set(p.id, {
          id: p.id,
          number: p.number,
          type: "issue",
          kind: p.kind,
          state: "open",
          title: p.title,
          body: p.body ?? "",
          author: e.actor,
          assignees: [],
          labels: [],
          references: [],
          timeline: [],
          created_at: e.occurred_at,
          updated_at: e.occurred_at,
          closed_at: null,
          superseded_by: null,
          resolved_by: null,
          originated_in_session: { type: "session", id: e.session_id },
        });
        break;
      }
      case EventKind.IssueStateChanged: {
        const p = e.payload as { id: string; state: "open" | "resolved" | "superseded"; superseded_by?: string };
        const it = issues.get(p.id);
        if (it) {
          it.state = p.state;
          it.updated_at = e.occurred_at;
          if (p.state === "resolved") it.resolved_by = e.actor;
          if (p.state === "superseded" && p.superseded_by) it.superseded_by = { type: "issue", id: p.superseded_by };
        }
        break;
      }
    }
    actors.set(aKey, slot);
  }

  // Recompute activity_state across ALL actors (existing + new) against the
  // current nowMs. This matches reduce()'s behavior: even an actor with no
  // events in this batch could have transitioned active→idle as time passed.
  for (const slot of actors.values()) {
    slot.activity_state = nowMs - new Date(slot.last_event_at).getTime() > IDLE_THRESHOLD_MS ? "idle" : "active";
  }

  // recent_activity merge: concat existing + new (orderedNew), re-sort by
  // current orderKey (defensive: orderKey can shift between calls if the
  // clock-skew threshold transitions for any event), slice to limit.
  const combinedRecent = [...existingRecent, ...orderedNew]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ka = orderKey(a.e, nowMs);
      const kb = orderKey(b.e, nowMs);
      return ka < kb ? -1 : ka > kb ? 1 : a.i - b.i;
    })
    .map(({ e }) => e)
    .slice(-RECENT_ACTIVITY_LIMIT);

  const result: ProjectStatus = {
    project_id: currentStatus.project_id,
    current_next_step: next_step,
    active_actors: [...actors.values()].sort((a, b) => b.last_event_at.localeCompare(a.last_event_at)),
    recent_activity: combinedRecent,
    open_issues: {
      decisions: [...issues.values()].filter((i) => i.kind === "decision" && i.state === "open"),
      questions: [...issues.values()].filter((i) => i.kind === "question" && i.state === "open"),
    },
    open_subtasks: [...subtasks.values()].filter((t) => t.state === "open"),
    updated_at: now,
  };
  if (currentStatus._meta) result._meta = { ...currentStatus._meta };
  return result;
}

// Recompute activity_state only — used when applyEvents is called with no new
// events. Time has still advanced, so active→idle transitions can occur.
function refreshActivityStates(currentStatus: ProjectStatus, nowMs: number, now: string): ProjectStatus {
  const refreshedActors = currentStatus.active_actors.map((a) => ({
    ...a,
    recent_files: [...a.recent_files],
    activity_state: (nowMs - new Date(a.last_event_at).getTime() > IDLE_THRESHOLD_MS ? "idle" : "active") as
      | "idle"
      | "active",
  }));
  const result: ProjectStatus = {
    ...currentStatus,
    active_actors: refreshedActors,
    open_issues: {
      decisions: [...currentStatus.open_issues.decisions],
      questions: [...currentStatus.open_issues.questions],
    },
    open_subtasks: [...currentStatus.open_subtasks],
    recent_activity: [...currentStatus.recent_activity],
    updated_at: now,
  };
  if (currentStatus._meta) result._meta = { ...currentStatus._meta };
  return result;
}

// Re-export for tests; backend wrapper uses these to compose the incremental
// recompute path with the existing full-fold function.
export { orderKey, IDLE_THRESHOLD_MS, RECENT_ACTIVITY_LIMIT };
export type { Actor };
