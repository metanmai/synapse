import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBrief } from "../../src/capture/handoff-brief.js";
import { runFlushCycle, runPullCycle } from "../../src/capture/handoff-sync.js";
import { runHandoffCmd } from "../../src/cli/handoff-commands.js";
import { runPostToolUseHook } from "../../src/hooks/post-tool-use.js";
import { runSessionStartHook } from "../../src/hooks/session-start.js";
import { startStubBackend } from "./stub-backend.js";

let stubUrl: string;
let stop: () => void;
let tanmaiHome: string;
let alexHome: string;

beforeEach(async () => {
  ({ url: stubUrl, stop } = await startStubBackend());
  tanmaiHome = fs.mkdtempSync("/tmp/syn-tanmai-");
  alexHome = fs.mkdtempSync("/tmp/syn-alex-");
});

afterEach(() => {
  stop();
  for (const h of [tanmaiHome, alexHome]) fs.rmSync(h, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("E2E: Tanmai-Monday → Alex-Tuesday handoff", () => {
  it("Alex's brief contains Tanmai's authored next_step", async () => {
    // -------- Monday: Tanmai --------
    process.env.SYNAPSE_HOME = tanmaiHome;
    const tanmaiStdout: string[] = [];
    await runSessionStartHook({
      project_id: "p1",
      user_id: "tanmai",
      stdout: { write: (s: string) => tanmaiStdout.push(s) > 0 } as NodeJS.WriteStream,
      skipFallback: true,
    });

    runPostToolUseHook({
      project_id: "p1",
      user_id: "tanmai",
      session_id: "s1",
      tool: "Edit",
      input: { file_path: "auth/oauth-callback.ts" },
      output: {},
    });
    runPostToolUseHook({
      project_id: "p1",
      user_id: "tanmai",
      session_id: "s1",
      tool: "Bash",
      input: { command: "git checkout feature/oauth" },
      output: { stdout: "Switched to branch 'feature/oauth'" },
    });

    await runHandoffCmd({
      project_id: "p1",
      user_id: "tanmai",
      session_id: "s1",
      text: "wire /callback to user repo; tests pass at HEAD",
    });
    await runFlushCycle({ project_id: "p1", api_key: "k", api_url: stubUrl });

    // -------- Tuesday: Alex --------
    process.env.SYNAPSE_HOME = alexHome;
    await runPullCycle({ project_id: "p1", api_key: "k", api_url: stubUrl });
    writeBrief("p1", "alex");

    const alexStdout: string[] = [];
    await runSessionStartHook({
      project_id: "p1",
      user_id: "alex",
      stdout: { write: (s: string) => alexStdout.push(s) > 0 } as NodeJS.WriteStream,
    });
    const brief = alexStdout.join("");

    expect(brief).toContain("wire /callback to user repo");
    expect(brief).toContain("tanmai");
    expect(brief).toMatch(/feature\/oauth|OAuth/);
  });
});

// Phase 2 (IDENT-02, D-06 + D-08 + D-09): same user, two machines, same git_remote_url.
// Machine A captures + flushes; Machine B (fresh tmpdir representing the same user on a
// different physical device) pulls + renders a brief. The brief MUST surface the remote
// actor's hostname so the user knows where the activity came from.
//
// RED until both Plan 02-03 (handoff-brief device-origin renderer) AND Plan 02-04
// (eager-pull mechanic) land. The test uses the existing runPullCycle which already
// handles status-pull; the cross-device hostname surfacing is what's missing today.

describe("E2E: machine A → machine B same user same repo (Phase 2 IDENT-02)", () => {
  it("brief on machine B contains machine A's hostname when device_id differs", async () => {
    const SAME_USER = "tanmai-uuid-2026";
    const REPO_URL = "https://github.com/tanmain/synapse.git";

    // -------- Machine A (tanmaiHome) — captures event, flushes to stub --------
    process.env.SYNAPSE_HOME = tanmaiHome;
    fs.writeFileSync(path.join(tanmaiHome, "device_id"), "device-A-hex");
    fs.mkdirSync(path.join(tanmaiHome, "projects/p-cross"), { recursive: true });

    // Write a controlled event directly. We bypass the hook because we need to
    // control actor.hostname (the real hook uses os.hostname() which would be
    // the test runner's hostname — same on both "machines" — defeating the assertion).
    const machineAEvent = {
      event_id: "01HZ_A_001",
      project_id: "p-cross",
      session_id: "s-A",
      actor: {
        user_id: SAME_USER,
        kind: "human" as const,
        device_id: "device-A-hex",
        hostname: "laptop-A",
        client: "claude-code" as const,
      },
      attached_to: null,
      // Reducer maps EventKind.NextStepSet ("next_step_set") → current_next_step
      // — that's the event runHandoffCmd emits. Plain "handoff" string is NOT
      // an EventKind variant, so the reducer ignores it.
      kind: "next_step_set" as const,
      occurred_at: "2026-05-20T09:00:00Z",
      received_at: "2026-05-20T09:00:01Z",
      payload: {
        text: "wire /callback to user repo; tests pass at HEAD",
        git_basename: "synapse",
        git_remote_url: REPO_URL,
      },
    };
    fs.writeFileSync(path.join(tanmaiHome, "projects/p-cross/events.jsonl"), `${JSON.stringify(machineAEvent)}\n`);

    const flushResult = await runFlushCycle({ project_id: "p-cross", api_key: "k", api_url: stubUrl });
    expect(flushResult.flushed).toBe(1);

    // -------- Machine B (alexHome) — same user, different device, pulls + briefs --------
    process.env.SYNAPSE_HOME = alexHome;
    fs.writeFileSync(path.join(alexHome, "device_id"), "device-B-hex");

    // Machine B's daemon pulls project status from the stub (existing path; future
    // Plan 02-04's runEagerPullCycle adds a full event pull on first link — but the
    // status-derived ProjectStatus is enough to surface the most-recent actor for the brief).
    await runPullCycle({ project_id: "p-cross", api_key: "k", api_url: stubUrl });
    writeBrief("p-cross", SAME_USER);

    const briefStdout: string[] = [];
    await runSessionStartHook({
      project_id: "p-cross",
      user_id: SAME_USER,
      stdout: { write: (s: string) => briefStdout.push(s) > 0 } as NodeJS.WriteStream,
    });
    const brief = briefStdout.join("");

    // Contract: D-09 (renderer) — same-user different-device surfaces the
    // remote actor's hostname. Substring match per feedback_test_generality.md
    // (don't lock the literal "(on laptop-A)" format).
    expect(brief).toContain("laptop-A");

    // Belt-and-suspenders: handoff text round-trips from machine A → stub
    // → machine B's brief. This proves the cross-device DATA path works
    // end-to-end (the reducer in stub-backend produces a ProjectStatus whose
    // current_next_step.text carries machine A's content, and the brief
    // renderer surfaces it). Plan 02-04's eager-pull (runEagerPullCycle +
    // stub /events extension) hooks the data flow together with Plan 02-03's
    // renderer to produce a fully-populated brief on machine B.
    expect(brief).toContain("wire /callback to user repo");
  });
});
