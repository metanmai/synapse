import child_process from "node:child_process";
import { LAUNCHD_LABEL, WINDOWS_TASK_NAME } from "../../capture/os-service.js";

/** Supervisor kinds Synapse can interrogate. `null` means "no supervisor — PID-file fallback". */
export type Supervisor = "launchd" | "systemd" | "taskscheduler" | null;

/**
 * Result of querying the OS service supervisor about the Synapse daemon.
 * Two-tier semantics: supervisor (launchd / systemd) is asked first; the PID
 * file fallback lives in `DaemonManager.status()`, not here.
 */
export interface SupervisorStatus {
  running: boolean;
  pid: number | null;
  supervisor: Supervisor;
}

const LAUNCHCTL_PID_REGEX = /^\s*pid\s*=\s*(\d+)/m;

/**
 * Synchronously check whether the Synapse capture daemon is currently running.
 * Pitfall 1: stdio is `["ignore","pipe","ignore"]` so we get exit-code semantics
 * without piping (piped exit codes mask the real exit and become 0).
 * Pitfall 5: `process.getuid()` is undefined on Windows — guard before use.
 *
 * Test/sandbox bypass: when `SYNAPSE_SKIP_SUPERVISOR_CHECK=1` is set in the
 * environment, we short-circuit to "no supervisor" without querying the
 * system. This is the only way to make daemon-related CLI commands
 * (`capture start`, `capture stop`, `uninstall`) testable in isolation —
 * launchctl/systemctl/schtasks are GLOBAL OS state that env-var-based
 * HOME/SYNAPSE_HOME sandboxing can't reach. Without this bypass, a
 * sandboxed e2e test sees the user's real daemon and either bails out
 * ("already running") or, worse, kills it on `capture stop`. The bypass
 * is intentionally scoped to a single env var so it can never be set by
 * accident in normal use.
 */
export function checkSupervisor(): SupervisorStatus {
  if (process.env.SYNAPSE_SKIP_SUPERVISOR_CHECK === "1") {
    return { running: false, pid: null, supervisor: null };
  }
  const platform = process.platform;

  if (platform === "darwin") {
    const uid = process.getuid?.();
    if (uid === undefined) return { running: false, pid: null, supervisor: null };
    try {
      const stdout = child_process.execSync(`launchctl print gui/${uid}/${LAUNCHD_LABEL}`, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      });
      const m = LAUNCHCTL_PID_REGEX.exec(stdout);
      const pid = m ? Number.parseInt(m[1], 10) : null;
      return { running: true, pid: Number.isNaN(pid as number) ? null : pid, supervisor: "launchd" };
    } catch {
      return { running: false, pid: null, supervisor: null };
    }
  }

  if (platform === "linux") {
    try {
      const active = child_process
        .execSync("systemctl --user is-active synapsesync.service", {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
        })
        .trim();
      if (active !== "active") return { running: false, pid: null, supervisor: null };
      try {
        const pidStr = child_process
          .execSync("systemctl --user show -p MainPID --value synapsesync.service", {
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf-8",
          })
          .trim();
        const pid = Number.parseInt(pidStr, 10);
        return {
          running: true,
          pid: Number.isNaN(pid) || pid === 0 ? null : pid,
          supervisor: "systemd",
        };
      } catch {
        return { running: true, pid: null, supervisor: "systemd" };
      }
    } catch {
      return { running: false, pid: null, supervisor: null };
    }
  }

  if (platform === "win32") {
    // schtasks /Query exit code is non-zero when the task doesn't exist, so
    // a successful invocation means the task is registered. The output
    // contains "Status: Running" / "Status: Ready" — we parse it to decide
    // running vs registered-but-idle. PID is intentionally null: schtasks
    // doesn't expose the spawned PID; getting it would require WMI which
    // is heavier than the value justifies for a status display.
    try {
      const out = child_process
        .execSync(`schtasks /Query /TN "${WINDOWS_TASK_NAME}" /FO LIST`, {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
          windowsHide: true,
        })
        .toString();
      const isRunning = /^Status:\s*Running\s*$/im.test(out);
      return { running: isRunning, pid: null, supervisor: "taskscheduler" };
    } catch {
      return { running: false, pid: null, supervisor: null };
    }
  }

  return { running: false, pid: null, supervisor: null };
}
