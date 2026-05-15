import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSessionStartHook } from "../../src/hooks/session-start.js";

describe("SessionStart hook", () => {
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

  it("prints empty <synapse-brief> when no cache exists, still writes session_opened event", async () => {
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, skipFallback: true });
    expect(out.join("")).toContain("<synapse-brief>");
    const events = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p1/events.jsonl"), "utf-8").trim());
    expect(events.kind).toBe("session_opened");
  });

  it("exits silently if SYNAPSE_DAEMON_SESSION env var is set (loop prevention)", async () => {
    process.env.SYNAPSE_DAEMON_SESSION = "1";
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout });
    expect(out).toEqual([]);
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_DAEMON_SESSION;
  });
});
