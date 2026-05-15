import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeDaemonCcProfile } from "../../src/capture/daemon-cc.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/syn-sandbox-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("daemon-CC sandbox profile", () => {
  it("denies all file-mutating tools and allows only Read", () => {
    const p = writeDaemonCcProfile();
    const profile = JSON.parse(fs.readFileSync(p, "utf-8"));
    const mutators = ["Edit", "Write", "MultiEdit", "Bash", "NotebookEdit", "Agent"];
    for (const m of mutators) expect(profile.permissions.deny).toContain(m);
    expect(profile.permissions.allow).toEqual(["Read"]);
  });
});
