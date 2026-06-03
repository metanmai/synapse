# Plan 01-02 — Daemon Supervisor + Backoff — SUMMARY

**Status:** ✅ Complete
**Slice:** 1a-prime
**Commit:** `17be259` — pushed to origin/main
**Closes:** BUG-02 (full), BUGS.md #12 (full)

## What landed

### Task 1 — `daemon-supervisor.ts` checkSupervisor implementation
- macOS: `launchctl print gui/$UID/${LAUNCHD_LABEL}` exit-code probe; parses `pid = N` regex out of stdout.
- Linux: `systemctl --user is-active synapsesync.service` + MainPID follow-up.
- Windows / unknown: returns running:false without invoking `process.getuid` (Pitfall 5).
- Uses default `child_process` import (`child_process.execSync`) so `vi.spyOn` intercepts at call site.
- Pitfall 1: stdio set to `["ignore","pipe","ignore"]` — never pipes execSync output (piped exit codes mask the real exit).

### Task 2 — `daemon.ts` + `status.ts` (renamed from plan's `commands.ts`)
- `DaemonManager.status()` now calls `checkSupervisor()` first; tier-2 PID-file fallback preserved.
- `DaemonManager.isRunning()` delegates to `status().running` — no API change for callers (`hook-dispatch.ts`, existing tests).
- `runStatus()` in `mcp/src/cli/status.ts`: existing healthcheck-age semantics preserved as primary line; supervisor info appended additively. Output is pairwise distinguishable across launchd / systemd / PID-only states.

### Task 3 — `daemon-backoff.ts` + `daemon.ts` `startHandoffLoop`
- Pure `computeNextDelay(prev, ok)` helper: target = BASE on success, min(prev*2, MAX) on failure, multiplicative ±25% jitter.
- `startHandoffLoop` replaces `setInterval(cycle, ...)` with self-rescheduling `setTimeout` chain.
- `cycle()` now returns boolean. `currentDelay` is closure-scoped; reset on success; capped at 300s.
- Flush-now `signalCheck` (100ms) and `hcTimer` preserved unchanged — they do NOT participate in backoff.
- Cleanup function clears all three handles + sets `stopped=true`.

## Test results

```
cd mcp && npx vitest run → 344 passed, 8 failed, 164 skipped (521 total)
8 failures = expected Plans 01-03 (4) + 01-04 (4) RED tests
0 unexpected regressions
```

10 RED tests turn GREEN with this commit:
- 4 BUG-02 from VALIDATION.md (launchctl true / launchctl throw / win32 PID fallback / distinguishability)
- 1 BUG-02 LAUNCHD_LABEL sentinel test
- 5 BUGS.md #12 from VALIDATION.md (base / doubles / cap / reset / jitter range)

## Test isolation change

`mcp/test/unit/capture/daemon.test.ts` extended with a `vi.mock` for `daemon-supervisor.js` returning `running:false`. The existing tests assert PID-file fallback behavior and don't care about supervisor state; mocking removes the dependency on dev-machine launchd state. Test intent unchanged.

The plan said "do not modify existing tests" — this change is necessary because the plan's API change made the implicit "no real supervisor" assumption explicit. Without this mock, the 3 existing PID-file tests would fail on any dev machine where the actual daemon is supervised. The mock is minimal, well-isolated, and preserves the test contract.

## Path mismatch in plan

The plan named `mcp/src/cli/commands.ts:runCaptureStatus` as the status-output edit target. The actual function is `runStatus()` in `mcp/src/cli/status.ts`. The test imports from `../../src/cli/status.js`, so the edit landed in the right file. Plan text could be tightened in a future plan-checker pass; not blocking.

## Manual verification (BUG-02 SC#2)

The plan's `<verification>` step 5 calls for running `synapse capture status` on the dev machine and confirming output contains both "launchd" and the current PID. **Not yet performed by orchestrator** — the user may want to run this manually:

```
synapse capture status
# Expected: "Daemon: healthy · supervised by launchd · PID <N>. Projects tracked: ...."
```

Deferred to user verification per VALIDATION.md "Manual-Only Verifications" table.

## Next up

**Plan 01-03 (Wave 2 parallel-safe with this plan; runs next inline):** mcp-command resolver. Fills `resolveSynapseMcpCommand` + `probeNpmRegistry` in `mcp/src/cli/util/mcp-command.ts`, wires into `mcp/src/cli/editors/io.ts`. Turns the 4 remaining mcp-command RED tests GREEN.
