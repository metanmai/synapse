// Wave 0 stub — fill in Plan 01-02 (BUG-02 — supervisor-aware daemon detection).
// Exports the type contract that Wave 2 production code will implement and Wave 1
// RED tests can import. Calling `checkSupervisor` at runtime throws "not implemented
// — Wave 2" so any premature use surfaces loudly.
//
// Plan 01-02's implementation MUST import `LAUNCHD_LABEL` from
// `../../capture/os-service.js` rather than redefining the literal — the
// LAUNCHD_LABEL invariant test (in `mcp/test/cli/status.test.ts`) uses
// `vi.mock` with a sentinel value to catch hard-coded duplicates.

/** Supervisor kinds Synapse can interrogate. `null` means "no supervisor — PID-file fallback". */
export type Supervisor = "launchd" | "systemd" | null;

/**
 * Result of querying the OS service supervisor about the Synapse daemon.
 * Wave 2 fills this with two-tier semantics:
 *   1. supervisor (launchd / systemd) is asked first
 *   2. PID file (`~/.synapse/capture.pid`) is the tier-2 fallback
 * `running === true` AND `supervisor === null` means the daemon is alive
 * but not under a supervisor (e.g. `synapse capture start` was run manually).
 */
export interface SupervisorStatus {
  running: boolean;
  pid: number | null;
  supervisor: Supervisor;
}

/**
 * Synchronously check whether the Synapse capture daemon is currently running.
 * Wave 2 (Plan 01-02) fills the body with platform-dispatch logic:
 *   - darwin: `launchctl print gui/$UID/${LAUNCHD_LABEL}` exit code 0 == running
 *   - linux:  `systemctl --user is-active synapsesync.service` stdout "active" == running
 *   - other:  fall through to PID-file check
 */
export function checkSupervisor(): SupervisorStatus {
  throw new Error("not implemented — Wave 2");
}
