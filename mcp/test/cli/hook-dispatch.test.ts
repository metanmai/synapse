import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchHook, hashCwd } from "../../src/cli/hook-dispatch.js";

describe("hook dispatch", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync("/tmp/synapse-test-");
    process.env.SYNAPSE_HOME = tmp;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_HOME;
  });

  it("routes session-start hook payload to runSessionStartHook", async () => {
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await dispatchHook("session-start", {
      project_id: "p1",
      user_id: "u1",
      stdout,
      skipFallback: true,
    });
    expect(out.join("")).toContain("<synapse-brief>");
    const events = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p1/events.jsonl"), "utf-8").trim());
    expect(events.kind).toBe("session_opened");
  });

  it("routes post-tool-use hook payload to runPostToolUseHook", async () => {
    await dispatchHook("post-tool-use", {
      project_id: "p2",
      user_id: "u1",
      session_id: "s1",
      tool: "Edit",
      input: { file_path: "/tmp/x" },
      output: { ok: true },
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p2/events.jsonl"), "utf-8");
    expect(log).toContain("file_touched");
  });

  it("routes pre-compact hook payload to runPreCompactHook", async () => {
    await dispatchHook("pre-compact", {
      project_id: "p3",
      user_id: "u1",
      session_id: "s1",
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p3/events.jsonl"), "utf-8");
    expect(log.length).toBeGreaterThan(0);
  });

  it("routes session-end hook payload to runSessionEndHook", async () => {
    await dispatchHook("session-end", {
      project_id: "p4",
      user_id: "u1",
      session_id: "s1",
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p4/events.jsonl"), "utf-8");
    expect(log).toContain("session_closed");
  });

  it("routes subagent-stop hook payload to runSubagentStopHook", async () => {
    await dispatchHook("subagent-stop", {
      project_id: "p5",
      user_id: "u1",
      session_id: "s1",
      subagent: "general-purpose",
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p5/events.jsonl"), "utf-8");
    expect(log).toContain("general-purpose");
  });

  it("writes unknown hook kind to stderr and does not throw", async () => {
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // biome-ignore lint/suspicious/noExplicitAny: stub stderr.write
    process.stderr.write = ((s: any) => {
      errs.push(String(s));
      return true;
    }) as typeof process.stderr.write;
    try {
      await dispatchHook("bogus-kind", {});
    } finally {
      process.stderr.write = origWrite;
    }
    expect(errs.join("")).toContain("unknown hook: bogus-kind");
  });

  it("hashCwd produces deterministic cwd_<12hex> ids", () => {
    const a = hashCwd("/Users/me/project");
    const b = hashCwd("/Users/me/project");
    expect(a).toBe(b);
    expect(a).toMatch(/^cwd_[a-f0-9]{12}$/);
    expect(hashCwd("/Users/me/other")).not.toBe(a);
  });
});
