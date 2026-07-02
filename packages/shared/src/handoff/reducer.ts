import { EventKind } from "./events.js";
import type { Event, FileTouch, Issue, ProjectStatus, Subtask } from "./types.js";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

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
  const recent = ordered.slice(-50);
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
