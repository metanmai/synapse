import { describe, expect, it } from "vitest";
import { EventKind } from "../../src/handoff/events.js";
import type { Actor, Event, Issue } from "../../src/handoff/types.js";

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
});
