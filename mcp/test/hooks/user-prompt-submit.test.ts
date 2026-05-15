import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUserPromptSubmitHook } from "../../src/hooks/user-prompt-submit.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-ups-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("UserPromptSubmit hook", () => {
  it("emits user_prompted event with truncated excerpt", () => {
    runUserPromptSubmitHook({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      prompt: "a".repeat(200),
      stdout: nullStream(),
    });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("user_prompted");
    expect((ev.payload.prompt_excerpt as string).length).toBe(80);
  });

  it("injects <synapse-status-update> when gap exceeds threshold", () => {
    fs.mkdirSync(path.join(tmp, "projects/p/cache"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/cache/project_status.json"), JSON.stringify(stubStatus()));
    fs.writeFileSync(
      path.join(tmp, "projects/p/last_injection.txt"),
      new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    );

    const out: string[] = [];
    runUserPromptSubmitHook({ project_id: "p", user_id: "u", session_id: "s", prompt: "ok", stdout: writeStream(out) });
    expect(out.join("")).toContain("<synapse-status-update>");
  });

  it("does NOT inject when gap is below threshold", () => {
    fs.mkdirSync(path.join(tmp, "projects/p/cache"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/cache/project_status.json"), JSON.stringify(stubStatus()));
    fs.writeFileSync(path.join(tmp, "projects/p/last_injection.txt"), new Date().toISOString());
    const out: string[] = [];
    runUserPromptSubmitHook({ project_id: "p", user_id: "u", session_id: "s", prompt: "ok", stdout: writeStream(out) });
    expect(out.join("")).not.toContain("<synapse-status-update>");
  });
});

function nullStream() {
  return { write: () => true } as unknown as NodeJS.WriteStream;
}
function writeStream(arr: string[]) {
  return {
    write: (s: string) => {
      arr.push(s);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
}
function stubStatus() {
  return {
    project_id: "p",
    current_next_step: null,
    active_actors: [],
    recent_activity: [],
    open_issues: { decisions: [], questions: [] },
    open_subtasks: [],
    updated_at: "t",
  };
}
