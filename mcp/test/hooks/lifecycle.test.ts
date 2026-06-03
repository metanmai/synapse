import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPreCompactHook } from "../../src/hooks/pre-compact.js";
import { runSessionEndHook } from "../../src/hooks/session-end.js";
import { runSubagentStopHook } from "../../src/hooks/subagent-stop.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-lc-"));
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("PreCompact hook", () => {
  it("emits context_compacted event and touches daemon-flush-now signal", () => {
    runPreCompactHook({ project_id: "p", user_id: "u", session_id: "s" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("context_compacted");
    expect(fs.existsSync(path.join(tmp, "daemon-flush-now"))).toBe(true);
  });
});

describe("SessionEnd hook", () => {
  it("emits session_closed event and touches flush signal", () => {
    runSessionEndHook({ project_id: "p", user_id: "u", session_id: "s" });
    const events = fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").split("\n").filter(Boolean);
    expect(JSON.parse(events[0]).kind).toBe("session_closed");
    expect(fs.existsSync(path.join(tmp, "daemon-flush-now"))).toBe(true);
  });
});

describe("SubagentStop hook", () => {
  it("emits tool_used event tagged with subagent name", () => {
    runSubagentStopHook({ project_id: "p", user_id: "u", session_id: "s", subagent: "Explore" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.payload.tool).toBe("Agent");
    expect(ev.payload.subagent).toBe("Explore");
  });
});
