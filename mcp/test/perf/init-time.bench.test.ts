import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../../src/cli/init.js";

let tmp: string;
let origHome: string | undefined;
let origCwd: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-init-perf-"));
  origHome = process.env.HOME;
  origCwd = process.cwd();
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp; // Windows: os.homedir() reads USERPROFILE, not HOME
  process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
  // Plan 01-04: runInit writes `.mcp.json` and `.gitignore` to process.cwd().
  // Isolate in tmp so those files don't leak into the mcp/ workspace.
  process.chdir(tmp);
  // Phase 2 (Plan 02-02): runInit calls fetchMe() before any disk write.
  // Mock fetch so the perf test measures local install time, not network latency.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ user_id: "perf-test-uuid", email: "perf@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (origHome !== undefined) {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origHome; // Windows: os.homedir() reads USERPROFILE, not HOME
  } else {
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.HOME;
  }
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
  vi.restoreAllMocks();
});

describe("synapse init time", () => {
  it("completes installer (without OS service registration) in <30s", async () => {
    const start = Date.now();
    await runInit({ api_key: "k", skip_service: true });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });
});
