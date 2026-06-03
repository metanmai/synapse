import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPostToolUseHook } from "../../src/hooks/post-tool-use.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-test-"));
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("PostToolUse hook", () => {
  it("Edit tool → file_touched event with path", () => {
    runPostToolUseHook({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      tool: "Edit",
      input: { file_path: "/repo/src/x.ts" },
      output: {},
    });
    const events = readJsonl(path.join(tmp, "projects/p/events.jsonl"));
    expect(events[0].kind).toBe("file_touched");
    expect(events[0].payload.path).toBe("/repo/src/x.ts");
  });

  it("Bash git commit → tool_used + commit_made", () => {
    runPostToolUseHook({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      tool: "Bash",
      input: { command: "git commit -m 'feat: x'" },
      output: { stdout: "[main 4585dca] feat: x" },
    });
    const events = readJsonl(path.join(tmp, "projects/p/events.jsonl"));
    expect(events.map((e: Record<string, unknown>) => e.kind)).toContain("commit_made");
  });

  it("Bash git checkout → branch_switched", () => {
    runPostToolUseHook({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      tool: "Bash",
      input: { command: "git checkout feature/oauth" },
      output: { stdout: "Switched to branch 'feature/oauth'" },
    });
    expect(readJsonl(path.join(tmp, "projects/p/events.jsonl")).map((e: Record<string, unknown>) => e.kind)).toContain(
      "branch_switched",
    );
  });

  it("TaskCreate → subtask_added", () => {
    runPostToolUseHook({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      tool: "TaskCreate",
      input: { subject: "Wire OAuth callback" },
      output: { taskId: "12" },
    });
    expect(readJsonl(path.join(tmp, "projects/p/events.jsonl"))[0].kind).toBe("subtask_added");
  });
});

function readJsonl(p: string) {
  return fs.readFileSync(p, "utf-8").split("\n").filter(Boolean).map(JSON.parse);
}
