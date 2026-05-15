import type { Event } from "@synapse/shared/handoff/types.js";
import { describe, expect, it } from "vitest";
import { synthesizeHeuristicNextStep } from "../../src/capture/heuristic-synth.js";

function ev(over: Partial<Event> & Pick<Event, "kind">): Event {
  return {
    event_id: Math.random().toString(36).slice(2),
    project_id: "p",
    session_id: "s",
    actor: {
      user_id: "u",
      kind: "human",
      device_id: "d",
      hostname: "h",
      client: "claude-code",
    },
    attached_to: null,
    occurred_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    payload: {},
    ...over,
  };
}

describe("synthesizeHeuristicNextStep", () => {
  it("uses focus_set as the primary signal when present", () => {
    const out = synthesizeHeuristicNextStep([ev({ kind: "focus_set", payload: { text: "OAuth callback wiring" } })]);
    expect(out).toContain("OAuth callback wiring");
  });

  it("falls back to last user prompt excerpt when no focus_set", () => {
    const out = synthesizeHeuristicNextStep([
      ev({ kind: "user_prompted", payload: { prompt_excerpt: "implement /callback route" } }),
    ]);
    expect(out).toContain("/callback");
  });

  it("includes open subtasks in the synthesized text", () => {
    const out = synthesizeHeuristicNextStep([
      ev({ kind: "subtask_added", payload: { task_id: "t1", text: "wire route" } }),
      ev({ kind: "subtask_added", payload: { task_id: "t2", text: "write test" } }),
    ]);
    expect(out).toMatch(/wire route|write test/);
  });

  it("never returns empty for non-empty event input", () => {
    const out = synthesizeHeuristicNextStep([ev({ kind: "tool_used", payload: { tool: "Bash" } })]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns a clear empty-fallback for empty input", () => {
    const out = synthesizeHeuristicNextStep([]);
    expect(out).toMatch(/no recent activity/i);
  });
});
