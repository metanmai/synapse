import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonManager } from "../../src/capture/daemon.js";
import { runDoctor, runStatus } from "../../src/cli/status.js";
import { type SupervisorExec, checkSupervisor } from "../../src/cli/util/daemon-supervisor.js";

let tmp: string;

// Leak guard: shim child_process.execSync to record any call that targets a
// supervisor binary (launchctl/systemctl/schtasks). Production behavior is
// preserved (we forward to the real impl). Each test that injects a fake
// platform+exec can snapshot the array before/after and assert no delta —
// this is the per-test "airtightness" probe. Tests that DELIBERATELY hit the
// real defaults (the `DaemonManager.status — works without any options` smoke
// test, or the top-level `runStatus()` tests) leave the snapshot logic out.
const supervisorEscapeLog: string[] = [];
const realExecSync = child_process.execSync;
// biome-ignore lint/suspicious/noExplicitAny: shim signature mirrors the overloaded execSync — typed via any to dodge the overload set.
(child_process as any).execSync = ((cmd: string | Buffer | URL, ...rest: unknown[]) => {
  const cmdStr = typeof cmd === "string" ? cmd : String(cmd);
  if (/^(launchctl|systemctl|schtasks)/i.test(cmdStr)) {
    supervisorEscapeLog.push(cmdStr);
  }
  // biome-ignore lint/suspicious/noExplicitAny: forward to real execSync without re-typing its overloads
  return (realExecSync as any).call(child_process, cmd, ...rest);
}) as typeof child_process.execSync;

/** Snapshot-and-diff helper for the per-test airtightness probe. */
function expectNoSupervisorEscape(fn: () => void): void {
  const before = supervisorEscapeLog.length;
  fn();
  const after = supervisorEscapeLog.length;
  expect(supervisorEscapeLog.slice(before, after)).toEqual([]);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-status-"));
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
// All cross-platform branches drive the source via dependency-injected
// `platform` + `exec` so a single CI runner (any OS) exercises darwin,
// linux, and win32 logic uniformly. NO it.skipIf gates — every test runs
// on every platform.

/**
 * Build a fake `exec` matcher that returns a stdout string when the command
 * matches `commandPattern`, throws an exec-style error otherwise. The
 * thrown error carries a `status` field mimicking the real execSync.
 */
function fakeExec(handlers: Array<{ match: RegExp; respond: () => string }>): {
  exec: SupervisorExec;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    exec: (cmd: string) => {
      calls.push(cmd);
      for (const h of handlers) {
        if (h.match.test(cmd)) {
          return h.respond();
        }
      }
      const err = new Error(`Command failed: ${cmd}`) as Error & { status?: number };
      err.status = 1;
      throw err;
    },
  };
}

describe("checkSupervisor — darwin (launchctl)", () => {
  it("returns running=true with PID + launchd supervisor when launchctl print succeeds", () => {
    const { exec, calls } = fakeExec([
      {
        match: /launchctl print/,
        respond: () => "label = app.synapsesync.daemon\n  pid = 12345\n  state = running\n",
      },
    ]);
    const sup = checkSupervisor({
      platform: "darwin",
      exec,
      getUid: () => 501,
    });
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(12345);
    expect(sup.supervisor).toBe("launchd");
    // The decision logic queried launchctl exactly once with the per-user
    // gui/<uid>/<label> form (not the system/launchd/... form).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("launchctl print");
    expect(calls[0]).toContain("gui/501/");
  });

  it("returns running=false when launchctl print throws (service not loaded, exit 113)", () => {
    const exec: SupervisorExec = () => {
      const err = new Error("Command failed: launchctl print") as Error & { status?: number };
      err.status = 113;
      throw err;
    };
    const sup = checkSupervisor({ platform: "darwin", exec, getUid: () => 501 });
    expect(sup.running).toBe(false);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe(null);
  });

  it("returns running=true with pid=null when launchctl prints output without a pid line", () => {
    // Edge case: launchctl loaded but spawned process is between exit/respawn —
    // the `pid =` line is absent for that moment. Source must still report
    // running:true (supervisor knows about it) and pid:null (we couldn't parse).
    const { exec } = fakeExec([
      {
        match: /launchctl print/,
        respond: () => "label = app.synapsesync.daemon\n  state = waiting\n",
      },
    ]);
    const sup = checkSupervisor({ platform: "darwin", exec, getUid: () => 501 });
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe("launchd");
  });

  it("returns no-supervisor when getuid is unavailable (Windows-on-darwin defensive)", () => {
    // Pitfall 5 from the source comment: process.getuid() is undefined on
    // Windows. If the platform is misdetected as darwin but getuid is
    // undefined we should bail rather than NaN-interpolate.
    const exec: SupervisorExec = () => {
      throw new Error("should not be called");
    };
    const sup = checkSupervisor({
      platform: "darwin",
      exec,
      getUid: () => undefined,
    });
    expect(sup.running).toBe(false);
    expect(sup.supervisor).toBe(null);
  });
});

describe("checkSupervisor — linux (systemctl)", () => {
  it("returns running=true with PID + systemd supervisor when is-active=active and MainPID parses", () => {
    const { exec, calls } = fakeExec([
      { match: /is-active synapsesync\.service/, respond: () => "active\n" },
      { match: /MainPID --value synapsesync\.service/, respond: () => "67890\n" },
    ]);
    const sup = checkSupervisor({ platform: "linux", exec });
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(67890);
    expect(sup.supervisor).toBe("systemd");
    // Both systemctl invocations should have happened, in order.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("is-active");
    expect(calls[1]).toContain("MainPID");
  });

  it("returns running=false when is-active reports inactive (output != 'active')", () => {
    const { exec, calls } = fakeExec([{ match: /is-active synapsesync\.service/, respond: () => "inactive\n" }]);
    const sup = checkSupervisor({ platform: "linux", exec });
    expect(sup.running).toBe(false);
    expect(sup.supervisor).toBe(null);
    // Should short-circuit before invoking the MainPID query.
    expect(calls).toHaveLength(1);
  });

  it("returns running=false when systemctl is-active throws (service not registered, or systemctl missing)", () => {
    const exec: SupervisorExec = () => {
      const err = new Error("Command failed: systemctl") as Error & { status?: number };
      err.status = 3; // systemctl's "unit not found" exit code
      throw err;
    };
    const sup = checkSupervisor({ platform: "linux", exec });
    expect(sup.running).toBe(false);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe(null);
  });

  it("returns running=true with pid=null when MainPID query fails after is-active=active", () => {
    // Defensive shape from source: is-active says yes, MainPID throws (e.g.
    // race during respawn) — still report running:true so the user sees the
    // daemon is up; pid is intentionally null since we couldn't parse one.
    const { exec } = fakeExec([
      { match: /is-active synapsesync\.service/, respond: () => "active\n" },
      // No handler for the MainPID query → fakeExec throws by default.
    ]);
    const sup = checkSupervisor({ platform: "linux", exec });
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe("systemd");
  });

  it("returns running=true with pid=null when MainPID is the systemd 'no main PID' sentinel '0'", () => {
    // systemd reports MainPID=0 for units that haven't fully started; treat
    // that as "running, PID unknown" — same as the unparseable case.
    const { exec } = fakeExec([
      { match: /is-active synapsesync\.service/, respond: () => "active\n" },
      { match: /MainPID --value synapsesync\.service/, respond: () => "0\n" },
    ]);
    const sup = checkSupervisor({ platform: "linux", exec });
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe("systemd");
  });
});

describe("checkSupervisor — win32 (schtasks)", () => {
  it("returns running=true with taskscheduler supervisor when schtasks output shows Status: Running", () => {
    const { exec, calls } = fakeExec([
      {
        match: /schtasks \/Query/,
        respond: () =>
          "HostName: WIN-CI\r\nTaskName: \\SynapseSync\r\nStatus: Running\r\nLogon Mode: Interactive only\r\n",
      },
    ]);
    const sup = checkSupervisor({ platform: "win32", exec });
    expect(sup.running).toBe(true);
    expect(sup.pid).toBe(null); // schtasks does not expose PID by design (source comment)
    expect(sup.supervisor).toBe("taskscheduler");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("schtasks /Query");
    expect(calls[0]).toContain("SynapseSync"); // task name from os-service.WINDOWS_TASK_NAME
  });

  it("returns running=false but supervisor=taskscheduler when task exists but Status: Ready (idle)", () => {
    // A registered-but-not-running task is the "task scheduler knows about
    // us, but the daemon isn't active right now" case. Source treats this
    // as running:false (task isn't running) but supervisor stays as
    // taskscheduler — distinct from the no-task-at-all case below.
    const { exec } = fakeExec([
      {
        match: /schtasks \/Query/,
        respond: () => "TaskName: \\SynapseSync\r\nStatus: Ready\r\nLogon Mode: Interactive only\r\n",
      },
    ]);
    const sup = checkSupervisor({ platform: "win32", exec });
    expect(sup.running).toBe(false);
    expect(sup.supervisor).toBe("taskscheduler");
  });

  it("returns running=false with supervisor=null when schtasks throws (task not registered)", () => {
    // schtasks exits non-zero when the task name doesn't exist — execSync
    // throws. Source must catch and report no-supervisor.
    const exec: SupervisorExec = () => {
      const err = new Error("ERROR: The system cannot find the file specified.") as Error & { status?: number };
      err.status = 1;
      throw err;
    };
    const sup = checkSupervisor({ platform: "win32", exec });
    expect(sup.running).toBe(false);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe(null);
  });

  it("returns running=false when schtasks output is malformed / lacks a Status line", () => {
    // Defensive: arbitrary garbage output (parse-error case) must default
    // to "not running" rather than crashing.
    const { exec } = fakeExec([{ match: /schtasks \/Query/, respond: () => "unexpected\r\n" }]);
    const sup = checkSupervisor({ platform: "win32", exec });
    expect(sup.running).toBe(false);
    expect(sup.supervisor).toBe("taskscheduler"); // task IS registered, just not running
  });
});

describe("checkSupervisor — unsupported platform", () => {
  it("returns {running:false, pid:null, supervisor:null} on freebsd/openbsd/etc", () => {
    const exec: SupervisorExec = () => {
      throw new Error("should not be called");
    };
    // NodeJS.Platform allows any of "aix"|"android"|"darwin"|"freebsd"|"haiku"|
    // "linux"|"openbsd"|"sunos"|"win32"|"cygwin"|"netbsd". Cast to the union
    // so we hit the source's "no platform matched" tail branch.
    const sup = checkSupervisor({ platform: "freebsd" as NodeJS.Platform, exec });
    expect(sup.running).toBe(false);
    expect(sup.pid).toBe(null);
    expect(sup.supervisor).toBe(null);
  });
});

describe("DaemonManager.status — tier-1 supervisor + tier-2 PID file fallback", () => {
  it("returns the supervisor result directly when tier-1 reports running:true", () => {
    // Tier-1 wins — the PID-file fallback should not be consulted.
    const dm = new DaemonManager(tmp, {
      supervisorCheck: () => ({ running: true, pid: 12345, supervisor: "launchd" }),
      // processAlive should never fire; rig it to throw if it does.
      processAlive: () => {
        throw new Error("PID fallback called when supervisor already said running:true");
      },
    });
    expect(dm.isRunning()).toBe(true);
    expect(dm.status()).toEqual({ running: true, pid: 12345, supervisor: "launchd" });
  });

  it("falls back to the PID file when tier-1 says not-running and the PID file points at a live process", () => {
    const dm = new DaemonManager(tmp, {
      supervisorCheck: () => ({ running: false, pid: null, supervisor: null }),
      // Live process — return true.
      processAlive: (pid) => pid === 4242,
    });
    dm.writePid(4242);
    expect(dm.isRunning()).toBe(true);
    const s = dm.status();
    expect(s.running).toBe(true);
    expect(s.pid).toBe(4242);
    expect(s.supervisor).toBe(null); // tier-2 has no supervisor
  });

  it("returns not-running AND cleans up the PID file when tier-2 finds a dead PID", () => {
    const dm = new DaemonManager(tmp, {
      supervisorCheck: () => ({ running: false, pid: null, supervisor: null }),
      processAlive: () => false, // dead
    });
    dm.writePid(999_999_999);
    // The PID file currently exists with the dead PID.
    const pidFile = path.join(tmp, "capture.pid");
    expect(fs.existsSync(pidFile)).toBe(true);

    expect(dm.isRunning()).toBe(false);

    // After status() observed the dead PID, the stale file should be gone.
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("returns not-running when neither tier-1 nor a PID file is available", () => {
    const dm = new DaemonManager(tmp, {
      supervisorCheck: () => ({ running: false, pid: null, supervisor: null }),
      processAlive: () => false,
    });
    expect(dm.isRunning()).toBe(false);
  });

  it("works without any options (defaults to real checkSupervisor + real process.kill probe)", () => {
    // Smoke check that the constructor signature is back-compat: production
    // call sites pass no opts and the defaults must still produce a usable
    // DaemonManager (we don't assert running state since it depends on host).
    const dm = new DaemonManager(tmp);
    const s = dm.status();
    expect(typeof s.running).toBe("boolean");
  });
});

describe("status output distinguishes launchd, systemd, and PID-only running states", () => {
  it("produces pairwise-distinct lines for {launchd+pid}, {systemd+pid}, {PID-only}", async () => {
    // Mocks runStatus's dependency on checkSupervisor via vi.doMock — same
    // strategy as the previous test design (runStatus has no injection point;
    // injection would require widening its signature for a single call site).
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
});

describe("injection-seam airtightness", () => {
  it("a darwin-injected checkSupervisor call does not shell out to the real launchctl", () => {
    // The shim at the top of the file records any call to the real
    // launchctl/systemctl/schtasks binaries. With a fake `exec` injected,
    // ZERO such calls should occur — proving the injection seam is the only
    // path the source takes when `exec` is provided.
    expectNoSupervisorEscape(() => {
      checkSupervisor({
        platform: "darwin",
        getUid: () => 501,
        exec: () => "pid = 1\n",
      });
    });
  });

  it("a linux-injected checkSupervisor call does not shell out to the real systemctl", () => {
    expectNoSupervisorEscape(() => {
      checkSupervisor({
        platform: "linux",
        exec: () => "active\n",
      });
    });
  });

  it("a win32-injected checkSupervisor call does not shell out to the real schtasks", () => {
    expectNoSupervisorEscape(() => {
      checkSupervisor({
        platform: "win32",
        exec: () => "Status: Running\n",
      });
    });
  });
});

describe("checkSupervisor — LAUNCHD_LABEL constant is consumed (not hard-coded)", () => {
  it("invokes launchctl with the LAUNCHD_LABEL imported from os-service (sentinel substitution survives)", async () => {
    // CLASS-CORRECT guard: replaces a source-text grep ("daemon-supervisor.ts
    // contains import LAUNCHD_LABEL"). We substitute a sentinel value for
    // the os-service module's LAUNCHD_LABEL export, then assert the actual
    // launchctl invocation contains the sentinel. If the source ever
    // hard-codes `app.synapsesync.daemon` instead of importing the
    // constant, the launchctl call won't contain TEST_SENTINEL_LABEL.
    //
    // Now runs on every platform (was darwin-only) — we drive the darwin
    // branch via injected `platform: "darwin"` and capture the exec call.
    vi.doMock("../../src/capture/os-service.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/capture/os-service.js")>();
      return {
        ...actual,
        LAUNCHD_LABEL: "TEST_SENTINEL_LABEL",
      };
    });
    vi.resetModules();

    const { checkSupervisor: cs } = await import("../../src/cli/util/daemon-supervisor.js");
    const calls: string[] = [];
    cs({
      platform: "darwin",
      getUid: () => 501,
      exec: (cmd) => {
        calls.push(cmd);
        return "pid = 12345\n";
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("TEST_SENTINEL_LABEL");
    // And it must NOT contain the production literal — proves the supervisor
    // is reading from the constant we just substituted.
    expect(calls[0]).not.toContain("app.synapsesync.daemon");

    vi.doUnmock("../../src/capture/os-service.js");
  });
});
