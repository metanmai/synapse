import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnInferNextStep, writeDaemonCcProfile } from "../../src/capture/daemon-cc.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-cc-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("daemon-cc", () => {
  it("writeDaemonCcProfile produces a profile that disables file-mutating tools", () => {
    const p = writeDaemonCcProfile();
    const profile = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(profile.permissions.deny).toContain("Edit");
    expect(profile.permissions.deny).toContain("Write");
    expect(profile.permissions.deny).toContain("Bash");
  });

  it("spawnInferNextStep invokes child with SYNAPSE_DAEMON_SESSION=1 env", async () => {
    interface Call {
      cmd: string;
      args: string[];
      env: NodeJS.ProcessEnv | undefined;
    }
    const calls: Call[] = [];
    const fakeSpawn = vi.fn((cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ cmd, args, env: opts.env });
      return {
        on: (event: string, cb: (code: number) => void) => {
          if (event === "close") setImmediate(() => cb(0));
        },
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        stdin: { end: () => {} },
      };
    });
    // biome-ignore lint/suspicious/noExplicitAny: fakeSpawn shape is compatible enough for the test
    await spawnInferNextStep({ project_id: "p", recent_events_summary: "foo", spawn: fakeSpawn as any });
    expect(calls[0].env?.SYNAPSE_DAEMON_SESSION).toBe("1");
  });
});
