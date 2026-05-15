import { describe, expect, it } from "vitest";
import { EventKind } from "../../src/handoff/events.js";
import { reduce } from "../../src/handoff/reducer.js";
import type { Actor, Event } from "../../src/handoff/types.js";

const A1: Actor = { user_id: "tanmai", kind: "human", device_id: "d1", hostname: "mbp", client: "claude-code" };
const A2: Actor = { user_id: "alex", kind: "human", device_id: "d2", hostname: "linux", client: "claude-code" };

function ev(over: Partial<Event>): Event {
  return {
    event_id: over.event_id ?? Math.random().toString(36).slice(2),
    project_id: "p",
    session_id: "s",
    actor: A1,
    attached_to: null,
    kind: EventKind.ToolUsed,
    occurred_at: "2026-05-11T09:00:00Z",
    received_at: "2026-05-11T09:00:00Z",
    payload: {},
    ...over,
  };
}

describe("reducer", () => {
  it("empty input → empty ProjectStatus", () => {
    const s = reduce([], "p");
    expect(s.active_actors).toEqual([]);
    expect(s.current_next_step).toBeNull();
  });

  it("LWW on next_step_set: latest occurred_at wins", () => {
    const earlier = ev({
      kind: EventKind.NextStepSet,
      occurred_at: "2026-05-11T09:00:00Z",
      payload: { text: "older" },
    });
    const later = ev({
      kind: EventKind.NextStepSet,
      occurred_at: "2026-05-11T11:00:00Z",
      payload: { text: "newer" },
      actor: A2,
    });
    const s = reduce([earlier, later], "p");
    expect(s.current_next_step?.text).toBe("newer");
    expect(s.current_next_step?.set_by.user_id).toBe("alex");
  });

  it("order-independence: same final state regardless of event order", () => {
    const events = [
      ev({ kind: EventKind.SessionOpened, occurred_at: "2026-05-11T09:00:00Z" }),
      ev({ kind: EventKind.FocusSet, occurred_at: "2026-05-11T09:30:00Z", payload: { text: "OAuth" } }),
      ev({ kind: EventKind.NextStepSet, occurred_at: "2026-05-11T17:00:00Z", payload: { text: "wire /callback" } }),
    ];
    const a = reduce(events, "p");
    const b = reduce([...events].reverse(), "p");
    expect(a.current_next_step?.text).toBe(b.current_next_step?.text);
    expect(a.active_actors[0]?.current_focus).toBe(b.active_actors[0]?.current_focus);
  });

  it("next_step_inferred sets inferred=true; next_step_set sets inferred=false", () => {
    const s1 = reduce([ev({ kind: EventKind.NextStepSet, payload: { text: "x" } })], "p");
    expect(s1.current_next_step?.inferred).toBe(false);
    const s2 = reduce([ev({ kind: EventKind.NextStepInferred, payload: { text: "x" } })], "p");
    expect(s2.current_next_step?.inferred).toBe(true);
  });

  it("active vs idle: actor with last event >30 min ago → idle", () => {
    const now = new Date("2026-05-11T12:00:00Z");
    const events = [ev({ occurred_at: "2026-05-11T11:00:00Z" })];
    const s = reduce(events, "p", { now });
    expect(s.active_actors[0]?.activity_state).toBe("idle");
  });

  it("aggregates open subtasks from subtask_added / subtask_completed events", () => {
    const events = [
      ev({ kind: EventKind.SubtaskAdded, payload: { task_id: "t1", text: "Wire callback" } }),
      ev({ kind: EventKind.SubtaskAdded, payload: { task_id: "t2", text: "Write test" } }),
      ev({ kind: EventKind.SubtaskCompleted, payload: { task_id: "t1" } }),
    ];
    const s = reduce(events, "p");
    expect(s.open_subtasks.map((t) => t.text)).toEqual(["Write test"]);
  });

  it("issues created via events appear in open_issues by kind", () => {
    const events = [
      ev({
        kind: EventKind.IssueCreated,
        payload: { id: "i1", number: 1, kind: "decision", title: "Use JWT lib", body: "" },
      }),
      ev({
        kind: EventKind.IssueCreated,
        payload: { id: "i2", number: 2, kind: "question", title: "PKCE?", body: "" },
      }),
      ev({ kind: EventKind.IssueStateChanged, payload: { id: "i1", state: "resolved" } }),
    ];
    const s = reduce(events, "p");
    expect(s.open_issues.questions.map((i) => i.title)).toEqual(["PKCE?"]);
    expect(s.open_issues.decisions).toEqual([]);
  });
});
