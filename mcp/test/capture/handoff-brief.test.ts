import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderBriefFromCache } from "../../src/capture/handoff-brief.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-brief-"));
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

function makeStatusFromActor(uid: string, nextStep: string, device_id = "d", hostname = "h") {
  return {
    project_id: "p1",
    current_next_step: {
      text: nextStep,
      set_by: { user_id: uid, kind: "human" as const, device_id, hostname, client: "claude-code" },
      set_at: "2026-05-11T17:00:00Z",
      inferred: false,
    },
    active_actors: [
      {
        actor: { user_id: uid, kind: "human" as const, device_id, hostname, client: "claude-code" },
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

// Phase 2 (IDENT-02, D-09): brief renderer differentiates same-device vs cross-device
// for the SAME user. When most-recent activity came from a different device of the same
// user, the brief surfaces the remote actor's hostname (e.g., "Your last activity (on laptop-A)").
// When same device, the existing "Your last activity" line is preserved (no hostname suffix).
// Per RESEARCH §Pattern 6 + Open Question 2 resolution: uses actor.hostname directly,
// NOT a join into api_keys.label (deferred to a follow-up).
//
// Plan 02-03 writes the local device_id to `${SYNAPSE_HOME}/device_id` on first capture
// (or init) — the renderer compares it to mostRecent.actor.device_id to decide which
// branch to render. The test setup writes the local device_id file directly to control
// the mismatch.

describe("renderBriefFromCache — D-09 device-origin attribution", () => {
  it("same-user same-device → 'Your last activity' (no hostname suffix, regression guard)", () => {
    fs.writeFileSync(path.join(tmp, "device_id"), "device-local");
    setupStatus(tmp, "p-same", makeStatusFromActor("tanmai", "wire /callback", "device-local", "laptop-local"));
    const brief = renderBriefFromCache("p-same", "tanmai");
    // Behavior contract (not literal format): same-device → "Your last activity" framing,
    // hostname need NOT appear (it's redundant when same device).
    expect(brief).toContain("Your last activity");
  });

  it("RED: same-user different-device → brief contains the remote actor's hostname (Plan 02-03)", () => {
    // RED until Plan 02-03: today's renderer doesn't read device_id; it shows the
    // "Your last activity" framing regardless of device. After Plan 02-03, when device_id
    // mismatches AND user_id matches, the brief includes the remote actor's hostname.
    fs.writeFileSync(path.join(tmp, "device_id"), "device-local");
    setupStatus(tmp, "p-cross", makeStatusFromActor("tanmai", "wire /callback", "device-remote", "laptop-remote"));
    const brief = renderBriefFromCache("p-cross", "tanmai");
    // Per feedback_test_generality.md: assert hostname appears in the brief somehow,
    // NOT the literal format "on laptop-remote" or "(laptop-remote)". The planner picks
    // the rendering; the contract is just "the user knows where the activity came from".
    expect(brief).toContain("laptop-remote");
  });

  it("different-user → 'Most recent activity' framing unchanged (regression — Phase 4 cross-user is OUT OF SCOPE here)", () => {
    fs.writeFileSync(path.join(tmp, "device_id"), "device-local");
    setupStatus(tmp, "p-other", makeStatusFromActor("alex", "wire /callback", "device-alex", "laptop-alex"));
    const brief = renderBriefFromCache("p-other", "tanmai"); // viewer is "tanmai", actor is "alex"
    expect(brief).toContain("Most recent activity");
    expect(brief).toContain("alex");
    // Phase 4 (cross-user) is OUT OF SCOPE; the existing other-user line must not regress.
  });
});
