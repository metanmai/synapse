import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderBriefFromCache } from "../../src/capture/handoff-brief.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-brief-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("renderBriefFromCache", () => {
  it("renders 'you are returning' framing when actor matches latest activity", () => {
    setupStatus(tmp, "p1", makeStatusFromActor("tanmai", "wire /callback"));
    const brief = renderBriefFromCache("p1", "tanmai");
    expect(brief).toContain("Your last activity");
    expect(brief).toContain("wire /callback");
  });

  it("renders 'teammate handoff' framing when actor differs", () => {
    setupStatus(tmp, "p1", makeStatusFromActor("tanmai", "wire /callback"));
    const brief = renderBriefFromCache("p1", "alex");
    expect(brief).toContain("Most recent activity");
    expect(brief).toContain("tanmai");
    expect(brief).toContain("wire /callback");
  });

  it("labels inferred next-steps explicitly", () => {
    const status = makeStatusFromActor("tanmai", "wire /callback");
    if (status.current_next_step) status.current_next_step.inferred = true;
    setupStatus(tmp, "p1", status);
    const brief = renderBriefFromCache("p1", "alex");
    expect(brief).toMatch(/Next step \(inferred/);
  });
});

function setupStatus(home: string, pid: string, status: unknown) {
  const dir = path.join(home, "projects", pid, "cache");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "project_status.json"), JSON.stringify(status));
}

function makeStatusFromActor(uid: string, nextStep: string) {
  return {
    project_id: "p1",
    current_next_step: {
      text: nextStep,
      set_by: { user_id: uid, kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" },
      set_at: "2026-05-11T17:00:00Z",
      inferred: false,
    },
    active_actors: [
      {
        actor: { user_id: uid, kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" },
        current_focus: "OAuth",
        branch: "feature/oauth",
        last_event_at: "2026-05-11T17:00:00Z",
        activity_state: "idle" as const,
        recent_files: [],
      },
    ],
    recent_activity: [],
    open_issues: { decisions: [], questions: [] },
    open_subtasks: [],
    updated_at: "2026-05-11T17:00:01Z",
  };
}
