import { describe, expect, it } from "vitest";
import { EventKind } from "../../src/handoff/events.js";
import { applyEvents, reduce } from "../../src/handoff/reducer.js";
import type { Actor, Event, ProjectStatus } from "../../src/handoff/types.js";

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

// BUGS.md #11 — applyEvents (incremental sibling of reduce).
//
// The guarded bug class: "incremental recompute output diverges from full
// recompute". A property-style equivalence test pins this: for every split
// point K, applyEvents(reduce(prefix), suffix) must deep-equal reduce(all)
// modulo bookkeeping fields (`updated_at` is `now`-dependent, `_meta` is
// reducer-private and only stamped by the backend wrapper).
describe("applyEvents — equivalence with reduce", () => {
  // Pin `now` so updated_at + activity_state are deterministic across both
  // reduce() and applyEvents() invocations in equivalence tests.
  const NOW = new Date("2026-05-11T12:00:00Z");

  // A representative ordered event sequence covering every reducer code path
  // (next_step LWW, focus, branch, file touches, subtask lifecycle, issue
  // lifecycle including a state transition on an open issue).
  function representativeEvents(): Event[] {
    return [
      ev({ event_id: "e1", kind: EventKind.SessionOpened, occurred_at: "2026-05-11T09:00:00Z" }),
      ev({
        event_id: "e2",
        kind: EventKind.UserPrompted,
        occurred_at: "2026-05-11T09:05:00Z",
        payload: { prompt_excerpt: "wire OAuth callback handler" },
      }),
      ev({ event_id: "e3", kind: EventKind.FocusSet, occurred_at: "2026-05-11T09:10:00Z", payload: { text: "OAuth" } }),
      ev({
        event_id: "e4",
        kind: EventKind.BranchSwitched,
        occurred_at: "2026-05-11T09:15:00Z",
        payload: { branch: "feature/oauth" },
      }),
      ev({
        event_id: "e5",
        kind: EventKind.FileTouched,
        occurred_at: "2026-05-11T09:20:00Z",
        payload: { path: "src/auth.ts", operation: "edit" },
      }),
      ev({
        event_id: "e6",
        kind: EventKind.SubtaskAdded,
        occurred_at: "2026-05-11T09:25:00Z",
        payload: { task_id: "t1", text: "Wire callback" },
      }),
      ev({
        event_id: "e7",
        kind: EventKind.SubtaskAdded,
        occurred_at: "2026-05-11T09:30:00Z",
        payload: { task_id: "t2", text: "Write test" },
      }),
      ev({
        event_id: "e8",
        kind: EventKind.IssueCreated,
        occurred_at: "2026-05-11T09:35:00Z",
        payload: { id: "i1", number: 1, kind: "decision", title: "Use JWT lib", body: "" },
      }),
      ev({
        event_id: "e9",
        kind: EventKind.IssueCreated,
        occurred_at: "2026-05-11T09:40:00Z",
        payload: { id: "i2", number: 2, kind: "question", title: "PKCE?", body: "" },
      }),
      ev({
        event_id: "e10",
        kind: EventKind.SubtaskCompleted,
        occurred_at: "2026-05-11T09:45:00Z",
        payload: { task_id: "t1" },
      }),
      ev({
        event_id: "e11",
        kind: EventKind.IssueStateChanged,
        occurred_at: "2026-05-11T09:50:00Z",
        payload: { id: "i1", state: "resolved" },
      }),
      ev({
        event_id: "e12",
        kind: EventKind.FileTouched,
        occurred_at: "2026-05-11T10:00:00Z",
        payload: { path: "test/auth.test.ts", operation: "create" },
      }),
      ev({
        event_id: "e13",
        kind: EventKind.NextStepInferred,
        occurred_at: "2026-05-11T10:05:00Z",
        payload: { text: "draft PR", inferred_method: "heuristic" },
      }),
      ev({
        event_id: "e14",
        kind: EventKind.NextStepSet,
        occurred_at: "2026-05-11T10:10:00Z",
        payload: { text: "wire /callback" },
      }),
      ev({
        event_id: "e15",
        kind: EventKind.UserPrompted,
        occurred_at: "2026-05-11T11:00:00Z",
        payload: { prompt_excerpt: "ship it" },
        actor: A2,
      }),
    ];
  }

  // The reducer-private bookkeeping bits that incremental and full
  // necessarily handle differently (updated_at uses `now`; _meta is stamped
  // by the backend wrapper, not the reducer itself).
  function stripBookkeeping(s: ProjectStatus): Omit<ProjectStatus, "updated_at" | "_meta"> {
    const { updated_at: _u, _meta: _m, ...rest } = s;
    return rest;
  }

  it("identity: empty newEvents preserves status (modulo activity_state recompute)", () => {
    const full = reduce(representativeEvents(), "p", { now: NOW });
    const incremental = applyEvents(full, [], { now: NOW });
    if (incremental === null) throw new Error("applyEvents returned null for empty newEvents — should be identity");
    expect(stripBookkeeping(incremental)).toEqual(stripBookkeeping(full));
  });

  it("property: reduce(all) == applyEvents(reduce(prefix), suffix) for EVERY split point", () => {
    // The whole point of the BUGS.md #11 refactor — the OUTPUT must be
    // identical for in-order event streams regardless of where the boundary
    // between "already-folded" and "new-this-batch" lands. If this property
    // ever breaks, we've introduced silent divergence — the dashboard would
    // show stale state that only converges on the next full recompute.
    const events = representativeEvents();
    const fullStatus = reduce(events, "p", { now: NOW });
    const fullStripped = stripBookkeeping(fullStatus);

    for (let split = 0; split <= events.length; split++) {
      const prefix = events.slice(0, split);
      const suffix = events.slice(split);
      const prefixStatus = reduce(prefix, "p", { now: NOW });
      const incremental = applyEvents(prefixStatus, suffix, { now: NOW });
      if (incremental === null) {
        throw new Error(`applyEvents returned null at split=${split}; in-order events should be safe`);
      }
      expect(stripBookkeeping(incremental), `divergence at split=${split}: incremental != full`).toEqual(fullStripped);
    }
  });

  it("safety bail: returns null when a new event has orderKey < watermark (out-of-order)", () => {
    // Bug class: late-arriving older event from a clock-skewed device. The
    // current persisted status doesn't carry enough state (e.g. resolved
    // issues are filtered out) to safely insert into the middle of the
    // timeline. Falling back to full recompute preserves correctness.
    const baseEvents = representativeEvents().slice(0, 8); // up to issue creation
    const status = reduce(baseEvents, "p", { now: NOW });

    const lateEvent = ev({
      event_id: "late-1",
      kind: EventKind.FocusSet,
      occurred_at: "2026-05-11T09:01:00Z", // BEFORE the watermark (~09:35)
      payload: { text: "old focus" },
    });

    expect(applyEvents(status, [lateEvent], { now: NOW })).toBeNull();
  });

  it("safety bail: returns null when IssueStateChanged targets an issue not in open_issues and not created in same batch", () => {
    // Bug class: reopen of a previously-resolved issue. The resolved issue
    // is filtered out of the persisted state, so we can't update its state.
    // Full recompute resurrects it via the internal issues map.
    const setup = [
      ev({
        event_id: "i1c",
        kind: EventKind.IssueCreated,
        occurred_at: "2026-05-11T09:00:00Z",
        payload: { id: "i1", number: 1, kind: "decision", title: "X", body: "" },
      }),
      ev({
        event_id: "i1r",
        kind: EventKind.IssueStateChanged,
        occurred_at: "2026-05-11T09:30:00Z",
        payload: { id: "i1", state: "resolved" },
      }),
    ];
    const status = reduce(setup, "p", { now: NOW });
    // i1 is no longer in status.open_issues.decisions — it's resolved
    expect(status.open_issues.decisions).toEqual([]);

    // Now try to reopen i1 incrementally
    const reopen = ev({
      event_id: "i1o",
      kind: EventKind.IssueStateChanged,
      occurred_at: "2026-05-11T09:35:00Z",
      payload: { id: "i1", state: "open" },
    });
    expect(applyEvents(status, [reopen], { now: NOW })).toBeNull();
  });

  it("IssueStateChanged on an issue created in same batch is safe (not a bail)", () => {
    // Bug class: false-positive bail rejecting a legitimate create-then-resolve
    // sequence inside one batch. The create+transition pair is self-contained
    // and reducible incrementally — bailing here would hurt the fast-path hit
    // rate for no correctness benefit.
    const fresh: ProjectStatus = reduce([], "p", { now: NOW });
    const events = [
      ev({
        event_id: "n1",
        kind: EventKind.IssueCreated,
        occurred_at: "2026-05-11T11:30:00Z",
        payload: { id: "i9", number: 9, kind: "question", title: "?", body: "" },
      }),
      ev({
        event_id: "n2",
        kind: EventKind.IssueStateChanged,
        occurred_at: "2026-05-11T11:31:00Z",
        payload: { id: "i9", state: "resolved" },
      }),
    ];
    const incremental = applyEvents(fresh, events, { now: NOW });
    expect(incremental).not.toBeNull();
    expect(incremental?.open_issues.questions).toEqual([]);
  });

  it("equivalence: actor's recent_files cap of 10 preserved across split boundary", () => {
    // Bug class: incremental over-includes or drops file touches when the
    // 10-file cap straddles the split boundary. Tests the slot.recent_files
    // = [...].slice(0, 10) logic incrementally.
    const events: Event[] = [];
    for (let i = 0; i < 15; i++) {
      events.push(
        ev({
          event_id: `f${i}`,
          kind: EventKind.FileTouched,
          occurred_at: new Date(2026, 4, 11, 9, i).toISOString(),
          payload: { path: `src/file-${i}.ts`, operation: "edit" },
        }),
      );
    }
    // Pick a split mid-stream to expose any cap-handling bug
    const split = 7;
    const full = reduce(events, "p", { now: NOW });
    const prefixStatus = reduce(events.slice(0, split), "p", { now: NOW });
    const incremental = applyEvents(prefixStatus, events.slice(split), { now: NOW });
    expect(incremental?.active_actors[0]?.recent_files.map((f) => f.path)).toEqual(
      full.active_actors[0]?.recent_files.map((f) => f.path),
    );
  });

  it("equivalence: recent_activity slice(-50) preserved across split when total exceeds 50", () => {
    // Bug class: recent_activity diverges when total > 50 events and the
    // split lands such that incremental concat-then-slice produces a
    // different last-50 window than full reduce.
    const events: Event[] = [];
    for (let i = 0; i < 75; i++) {
      events.push(
        ev({
          event_id: `r${i}`,
          // Use minute offsets only (max 60) to stay valid ISO strings.
          occurred_at: new Date(2026, 4, 11, 9, Math.floor(i / 10) * 10 + (i % 10)).toISOString(),
        }),
      );
    }
    const full = reduce(events, "p", { now: NOW });
    const split = 30;
    const prefixStatus = reduce(events.slice(0, split), "p", { now: NOW });
    const incremental = applyEvents(prefixStatus, events.slice(split), { now: NOW });
    expect(incremental?.recent_activity.length).toBe(50);
    expect(incremental?.recent_activity.map((e) => e.event_id)).toEqual(full.recent_activity.map((e) => e.event_id));
  });

  it("preserves _meta from currentStatus (bookkeeping carry-forward)", () => {
    // The reducer itself doesn't stamp _meta — only the backend wrapper
    // does that on the full-recompute path. But applyEvents must carry the
    // bookkeeping field forward; otherwise every incremental call would
    // effectively reset the 5-min full-recompute timer and full path never
    // fires.
    const base = reduce(representativeEvents().slice(0, 5), "p", { now: NOW });
    const withMeta: ProjectStatus = {
      ...base,
      _meta: { last_full_recompute_at: "2026-05-11T11:50:00Z" },
    };
    const incremental = applyEvents(withMeta, representativeEvents().slice(5), { now: NOW });
    expect(incremental?._meta?.last_full_recompute_at).toBe("2026-05-11T11:50:00Z");
  });
});
