import fs from "node:fs";
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
