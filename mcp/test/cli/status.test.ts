import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonManager } from "../../src/capture/daemon.js";
import { runDoctor, runStatus } from "../../src/cli/status.js";
import { checkSupervisor } from "../../src/cli/util/daemon-supervisor.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-status-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("synapse status", () => {
  it("shows healthy when healthcheck is fresh", async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date().toISOString());
    const out = await runStatus();
    expect(out).toContain("Daemon: healthy");
  });

  it("shows stale when healthcheck is older than 60s", async () => {
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date(Date.now() - 120_000).toISOString());
    const out = await runStatus();
    expect(out).toContain("Daemon: STALE");
  });
});

describe("synapse doctor", () => {
  it("reports project count, last push, last pull, queued events", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/events.jsonl"), `${JSON.stringify({ event_id: "x" })}\n`);
    const out = await runDoctor();
    expect(out).toContain("Projects tracked: 1");
    expect(out).toContain("Queued events");
  });
});

// VALIDATION row mapping (01-VALIDATION.md "Per-Task Verification Map"):
//   BUG-02 → "returns true when launchctl print reports the label loaded"
//   BUG-02 → "returns false when launchctl print throws (service not loaded)"
//   BUG-02 → "falls back to PID-file check on non-supervisor platforms"
//   BUG-02 → "capture status distinguishes launchd, systemd, and PID-only outputs"
//   BUG-02 (LAUNCHD_LABEL sentinel) → "daemon-supervisor invokes launchctl with the
//     LAUNCHD_LABEL imported from os-service (not a redefined literal)"
//
// All 5 cases below are RED until Plan 01-02 (Wave 2) lands the
// supervisor-aware `DaemonManager.isRunning()` + `checkSupervisor` impl.

describe("DaemonManager.isRunning + checkSupervisor (BUG-02)", () => {
  it("returns true when launchctl print reports the label loaded", () => {
    // launchctl print emits a multi-line body containing `pid = 12345`.
    // Wave 2 parses it and surfaces { running: true, pid: 12345, supervisor: "launchd" }.
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    vi.spyOn(child_process, "execSync").mockReturnValue(
      "label = app.synapsesync.daemon\n  pid = 12345\n  state = running\n" as unknown as Buffer,
    );

    const dm = new DaemonManager(tmp);
    expect(dm.isRunning()).toBe(true);

    const sup = checkSupervisor();
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(12345);
    expect(sup.supervisor).toBe("launchd");
  });

  it("returns false when launchctl print throws (service not loaded)", () => {
    // launchctl exits 113 when the label is unknown; execSync throws.
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      const err = new Error("Command failed: launchctl print") as Error & { status?: number };
      err.status = 113;
      throw err;
    });

    const sup = checkSupervisor();
    expect(sup.running).toBe(false);

    const dm = new DaemonManager(tmp);
    expect(dm.isRunning()).toBe(false);
  });

  it("falls back to PID-file check on non-supervisor platforms", () => {
    // On win32, no launchd / systemd available; tier-2 PID file check runs.
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const dm = new DaemonManager(tmp);
    // Plant a PID file pointing at a live process (this test process).
    dm.writePid(process.pid);
    expect(dm.isRunning()).toBe(true);

    // Now plant a PID file pointing at a likely-dead process.
    dm.writePid(999_999_999);
    expect(dm.isRunning()).toBe(false);
  });

  it("capture status distinguishes launchd, systemd, and PID-only outputs from each other", async () => {
    // Mock `checkSupervisor` to return three distinct shapes via dynamic
    // module replacement. We want runStatus() (or its Wave-2 successor) to
    // produce three pairwise-distinct outputs that each carry the supervisor
    // name + PID for the supervised cases, and the PID without supervisor
    // name for the unsupervised case.
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date().toISOString());

    vi.doMock("../../src/cli/util/daemon-supervisor.js", () => ({
      checkSupervisor: vi.fn().mockReturnValue({
        running: true,
        pid: 12345,
        supervisor: "launchd",
      }),
    }));
    vi.resetModules();
    const launchdMod = await import("../../src/cli/status.js");
    const launchdOut = await launchdMod.runStatus();

    vi.doMock("../../src/cli/util/daemon-supervisor.js", () => ({
      checkSupervisor: vi.fn().mockReturnValue({
        running: true,
        pid: 67890,
        supervisor: "systemd",
      }),
    }));
    vi.resetModules();
    const systemdMod = await import("../../src/cli/status.js");
    const systemdOut = await systemdMod.runStatus();

    vi.doMock("../../src/cli/util/daemon-supervisor.js", () => ({
      checkSupervisor: vi.fn().mockReturnValue({
        running: true,
        pid: 11111,
        supervisor: null,
      }),
    }));
    vi.resetModules();
    const pidOnlyMod = await import("../../src/cli/status.js");
    const pidOnlyOut = await pidOnlyMod.runStatus();

    vi.doUnmock("../../src/cli/util/daemon-supervisor.js");

    // (a) Pairwise distinctness — captures the "all three look the same" bug class.
    expect(launchdOut).not.toBe(systemdOut);
    expect(launchdOut).not.toBe(pidOnlyOut);
    expect(systemdOut).not.toBe(pidOnlyOut);

    // (b) launchd output carries the supervisor name + PID.
    expect(launchdOut).toContain("launchd");
    expect(launchdOut).toContain("12345");

    // (c) systemd output carries the supervisor name + PID.
    expect(systemdOut).toContain("systemd");
    expect(systemdOut).toContain("67890");

    // (d) PID-only output carries the PID and NOT a supervisor name.
    expect(pidOnlyOut).toContain("11111");
    expect(pidOnlyOut).not.toContain("launchd");
    expect(pidOnlyOut).not.toContain("systemd");
  });

  it("daemon-supervisor invokes launchctl with the LAUNCHD_LABEL imported from os-service (not a redefined literal)", async () => {
    // CLASS-CORRECT guard: replaces a source-text grep ("daemon-supervisor.ts
    // contains import LAUNCHD_LABEL"). We substitute a sentinel value for the
    // os-service module's LAUNCHD_LABEL export, then assert that the actual
    // launchctl invocation contains the sentinel. If Plan 01-02 hard-codes
    // the literal `app.synapsesync.daemon` instead of importing the constant,
    // the launchctl call won't contain TEST_SENTINEL_LABEL and this fails.
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    vi.doMock("../../src/capture/os-service.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/capture/os-service.js")>();
      return {
        ...actual,
        LAUNCHD_LABEL: "TEST_SENTINEL_LABEL",
      };
    });
    vi.resetModules();

    const execSyncSpy = vi.fn().mockReturnValue("pid = 12345\n" as unknown as Buffer);
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        default: { ...actual, execSync: execSyncSpy },
        execSync: execSyncSpy,
      };
    });
    vi.resetModules();

    const { checkSupervisor: cs } = await import("../../src/cli/util/daemon-supervisor.js");
    cs();

    expect(execSyncSpy).toHaveBeenCalled();
    const firstArg = String(execSyncSpy.mock.calls[0][0]);
    expect(firstArg).toContain("TEST_SENTINEL_LABEL");
    // And it must NOT contain the production literal — proves the supervisor
    // is reading from the constant we just substituted.
    expect(firstArg).not.toContain("app.synapsesync.daemon");

    vi.doUnmock("../../src/capture/os-service.js");
    vi.doUnmock("node:child_process");
  });
});
