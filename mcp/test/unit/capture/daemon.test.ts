import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonManager } from "../../../src/capture/daemon.js";

// Isolate from real supervisor state: dev machines may have an actual
// launchd-supervised daemon alive (Plan 01-02 added supervisor-aware
// detection to DaemonManager.status). These tests are about the PID-file
// fallback path, so checkSupervisor is stubbed to report "no supervisor."
vi.mock("../../../src/cli/util/daemon-supervisor.js", () => ({
  checkSupervisor: () => ({ running: false, pid: null, supervisor: null }),
}));

describe("DaemonManager", () => {
  let tmpDir: string;
  let manager: DaemonManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-daemon-test-"));
    manager = new DaemonManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports not running when no PID file exists", () => {
    expect(manager.isRunning()).toBe(false);
  });

  it("reports not running when PID file has stale PID", () => {
    fs.writeFileSync(path.join(tmpDir, "capture.pid"), "999999999");
    expect(manager.isRunning()).toBe(false);
  });

  it("writes and reads PID file", () => {
    manager.writePid(12345);
    expect(manager.readPid()).toBe(12345);
  });

  it("cleans up PID file", () => {
    manager.writePid(12345);
    manager.cleanup();
    expect(manager.readPid()).toBeNull();
  });

  it("returns status with running state and PID", () => {
    const status = manager.status();
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
  });
});
