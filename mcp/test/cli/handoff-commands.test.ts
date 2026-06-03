import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffCmd, runNoteCmd, runSetFocusCmd } from "../../src/cli/handoff-commands.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-hc-"));
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("handoff CLI", () => {
  it("synapse handoff writes next_step_set event", async () => {
    await runHandoffCmd({ project_id: "p", user_id: "u", session_id: "s", text: "wire /callback" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("next_step_set");
    expect(ev.payload.text).toBe("wire /callback");
  });

  it("synapse set-focus writes focus_set event", async () => {
    await runSetFocusCmd({ project_id: "p", user_id: "u", session_id: "s", text: "OAuth wiring" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("focus_set");
  });

  it("synapse note writes issue_noted event with object ref", async () => {
    await runNoteCmd({ project_id: "p", user_id: "u", session_id: "s", target: "issue:12", text: "FYI" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("issue_noted");
    expect(ev.payload.target).toBe("issue:12");
  });
});
