import { EventKind } from "./events.js";
import type { Event, FileTouch, ProjectStatus } from "./types.js";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

export interface ReduceOptions {
  now?: Date;
}

export function reduce(events: Event[], project_id: string, opts: ReduceOptions = {}): ProjectStatus {
  const now = (opts.now ?? new Date()).toISOString();
  // Order by occurred_at (LWW), fall back to received_at if occurred_at is implausible (>5 min in future of now).
  const nowMs = new Date(now).getTime();
  const ordered = [...events].sort((a, b) => orderKey(a, nowMs).localeCompare(orderKey(b, nowMs)));

  let next_step: ProjectStatus["current_next_step"] = null;
  const actors = new Map<string, ProjectStatus["active_actors"][number]>();
  const recent = ordered.slice(-50);

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
      case EventKind.NextStepInferred:
        next_step = { text: String(e.payload.text ?? ""), set_by: e.actor, set_at: e.occurred_at, inferred: true };
        break;
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
    open_issues: { decisions: [], questions: [] }, // populated by Task 8 (issue handling)
    open_subtasks: [], // populated by Task 8 (subtask extraction)
    updated_at: now,
  };
}

function orderKey(e: Event, nowMs: number): string {
  // Use received_at when occurred_at is implausibly far in the future relative to now (clock skew guard).
  const occMs = new Date(e.occurred_at).getTime();
  if (occMs - nowMs > 5 * 60 * 1000) return `${e.received_at}|${e.event_id}`;
  return `${e.occurred_at}|${e.event_id}`;
}
