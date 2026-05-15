import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIssueCreate, runIssueResolve, runIssueSupersede } from "../../src/cli/handoff-commands.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-issue-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("synapse issue", () => {
  it("create emits issue_created with kind and title", async () => {
    await runIssueCreate({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      kind: "decision",
      title: "Use JWT",
      body: "",
    });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("issue_created");
    expect(ev.payload.kind).toBe("decision");
  });

  it("resolve emits issue_state_changed → resolved", async () => {
    await runIssueResolve({
      project_id: "p",
      user_id: "u",
      session_id: "s",
      issue_id: "i1",
      resolution: "going with JWT",
    });
    const lines = fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").split("\n").filter(Boolean);
    const ev = JSON.parse(lines[lines.length - 1]);
    expect(ev.kind).toBe("issue_state_changed");
    expect(ev.payload.state).toBe("resolved");
  });

  it("supersede emits issue_state_changed → superseded with replacement ref", async () => {
    await runIssueSupersede({ project_id: "p", user_id: "u", session_id: "s", issue_id: "i1", superseded_by: "i2" });
    const last = fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").split("\n").filter(Boolean).at(-1);
    if (!last) throw new Error("no events");
    const ev = JSON.parse(last);
    expect(ev.payload.state).toBe("superseded");
    expect(ev.payload.superseded_by).toBe("i2");
  });
});
