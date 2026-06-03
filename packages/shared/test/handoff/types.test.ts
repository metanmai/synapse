import { describe, expect, it } from "vitest";
import { EventKind } from "../../src/handoff/events.js";
import type { Actor, Event, Issue, ProjectStatus, Session, Subtask } from "../../src/handoff/types.js";

describe("handoff types", () => {
  it("Actor with kind=human is valid", () => {
    const a: Actor = { user_id: "u1", kind: "human", device_id: "d1", hostname: "macbook", client: "claude-code" };
    expect(a.kind).toBe("human");
  });

  it("Event has all required fields and a known kind", () => {
    const e: Event = {
      event_id: "01HZ...",
      project_id: "p1",
      session_id: "s1",
      actor: { user_id: "u1", kind: "human", device_id: "d1", hostname: "h", client: "claude-code" },
      attached_to: null,
      kind: EventKind.SessionOpened,
      occurred_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      payload: {},
    };
    expect(e.kind).toBe("session_opened");
  });

  it("Issue.kind is one of decision | question", () => {
    const i: Issue = {
      id: "i1",
      number: 1,
      type: "issue",
      title: "x",
      body: "",
      state: "open",
      kind: "decision",
      author: { user_id: "u1", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
      assignees: [],
      labels: [],
      references: [],
      timeline: [],
      created_at: "t",
      updated_at: "t",
      closed_at: null,
      superseded_by: null,
      resolved_by: null,
      originated_in_session: null,
    };
    expect(["decision", "question"]).toContain(i.kind);
  });

  it("Session has all required fields including state machine", () => {
    const s: Session = {
      id: "ses_1",
      number: 1,
      type: "session",
      title: "OAuth callback",
      body: "",
      state: "open",
      author: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
      assignees: [],
      labels: [],
      references: [],
      timeline: [],
      created_at: "t",
      updated_at: "t",
      closed_at: null,
      project_id: "p",
      branch_at_start: "main",
      base_commit: null,
      started_at: "t",
      last_event_at: "t",
    };
    expect(s.state).toBe("open");
  });

  it("ProjectStatus current_next_step carries inferred flag", () => {
    const ps: ProjectStatus = {
      project_id: "p",
      current_next_step: {
        text: "x",
        set_by: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
        set_at: "t",
        inferred: true,
      },
      active_actors: [],
      recent_activity: [],
      open_issues: { decisions: [], questions: [] },
      open_subtasks: [],
      updated_at: "t",
    };
    expect(ps.current_next_step?.inferred).toBe(true);
  });

  it("Subtask state can be 'open' or 'done'", () => {
    const t: Subtask = {
      id: "t1",
      text: "wire route",
      state: "open",
      parent: { type: "session", id: "s1" },
      done_at: null,
      done_by: null,
    };
    expect(t.state).toBe("open");
  });
});
