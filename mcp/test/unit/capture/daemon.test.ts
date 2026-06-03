import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonManager, reconcileProjects } from "../../../src/capture/daemon.js";

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

// Bug class: the daemon's cycle() iterates `projects` array and calls
// runFlushCycle for each. Without reconciliation, entries persisted across
// cycles even after their dir was deleted (e.g. by canonical-id remap), so
// every subsequent cycle threw `ENOENT: ... <stale-dir>/.watermark` and
// the daemon log filled with per-cycle error spam.
//
// Verified 2026-05-24 from production daemon log:
//   [handoff] cycle error cwd_27c6bd8756e4 Error: ENOENT: no such file or
//   directory, open '/Users/Tanmai.N/.synapse/projects/cwd_27c6bd8756e4/.watermark'
//
// Tests guard the bug CLASS — they assert (a) stale entries get pruned,
// (b) new on-disk dirs get added, and (c) both happen together in a
// single reconcile call.
describe("reconcileProjects", () => {
  let projectsDir: string;

  beforeEach(() => {
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-reconcile-test-"));
  });

  afterEach(() => {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  function mkProjectDir(name: string): void {
    fs.mkdirSync(path.join(projectsDir, name));
  }

  it("prunes entries whose dir no longer exists", () => {
    mkProjectDir("alive-1");
    mkProjectDir("alive-2");
    // "dead-cwd-hash" is tracked in memory but its dir was deleted (e.g.
    // canonical-id remap finished and removed the pseudo-dir).
    const projects = ["alive-1", "dead-cwd-hash", "alive-2"];

    reconcileProjects(projects, projectsDir);

    expect(projects).toEqual(expect.arrayContaining(["alive-1", "alive-2"]));
    expect(projects).not.toContain("dead-cwd-hash");
    expect(projects).toHaveLength(2);
  });

  it("adds on-disk dirs that aren't tracked yet (additive scan)", () => {
    mkProjectDir("tracked");
    mkProjectDir("untracked-newcomer");
    const projects = ["tracked"];

    reconcileProjects(projects, projectsDir);

    expect(projects).toEqual(expect.arrayContaining(["tracked", "untracked-newcomer"]));
    expect(projects).toHaveLength(2);
  });

  it("handles prune + add in the same call (the realistic state)", () => {
    // On disk: one survivor, one newcomer. Not on disk: one we used to track.
    mkProjectDir("survivor");
    mkProjectDir("newcomer");
    const projects = ["survivor", "stale-entry"];

    reconcileProjects(projects, projectsDir);

    expect(projects).toEqual(expect.arrayContaining(["survivor", "newcomer"]));
    expect(projects).not.toContain("stale-entry");
    expect(projects).toHaveLength(2);
  });

  it("ignores dotfiles in the projects dir", () => {
    mkProjectDir("real-project");
    fs.writeFileSync(path.join(projectsDir, ".DS_Store"), "");
    fs.writeFileSync(path.join(projectsDir, ".hidden-file"), "");
    const projects: string[] = [];

    reconcileProjects(projects, projectsDir);

    expect(projects).toEqual(["real-project"]);
  });

  it("ignores non-directory entries", () => {
    mkProjectDir("dir-entry");
    fs.writeFileSync(path.join(projectsDir, "stray-file"), "not a project");
    const projects: string[] = [];

    reconcileProjects(projects, projectsDir);

    expect(projects).toEqual(["dir-entry"]);
  });
});
