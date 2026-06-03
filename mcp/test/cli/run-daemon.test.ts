import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemon } from "../../src/cli/run-daemon.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-daemon-cli-");
  process.env.SYNAPSE_HOME = tmp;
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ api_key: "k" }));
  fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "projects/p2"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("runDaemon", () => {
  it("discovers tracked projects and starts handoff loop", async () => {
    const startSpy = vi.fn(() => () => {});
    const stop = runDaemon({ _testStartLoop: startSpy, _exitImmediately: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(startSpy).toHaveBeenCalled();
    const call = startSpy.mock.calls[0][0];
    expect(call.projects).toContain("p1");
    expect(call.projects).toContain("p2");
    expect(call.api_key).toBe("k");
    expect(call.api_url).toBe("https://api.synapsesync.app");
    stop();
  });

  it("logs and exits cleanly with no projects to track", async () => {
    fs.rmSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.rmSync(path.join(tmp, "projects/p2"), { recursive: true });
    const startSpy = vi.fn(() => () => {});
    const stop = runDaemon({ _testStartLoop: startSpy, _exitImmediately: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ projects: [] }));
    stop();
  });

  it("returns a no-op stop and skips startLoop when api_key is missing", async () => {
    fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({}));
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_API_KEY;
    const startSpy = vi.fn(() => () => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = runDaemon({ _testStartLoop: startSpy, _exitImmediately: true });
    expect(startSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    stop();
    errSpy.mockRestore();
  });
});
