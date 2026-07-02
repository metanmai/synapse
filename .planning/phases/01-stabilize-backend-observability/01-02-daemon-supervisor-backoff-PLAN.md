---
phase: 01-stabilize-backend-observability
plan: 02
type: execute
wave: 2
slice: 1a
depends_on: [01-01]
files_modified:
  - mcp/src/cli/util/daemon-supervisor.ts
  - mcp/src/capture/daemon.ts
  - mcp/src/cli/commands.ts
autonomous: true
requirements: [BUG-02, BUGS-MD-12]

must_haves:
  truths:
    - "When the launchd-supervised daemon is running on macOS, `synapse capture status` reports 'Daemon: running' and tags 'supervised by launchd' with the launchd-reported PID."
    - "When the daemon is unsupervised (or launchctl reports the label is not loaded), `isRunning()` falls back to the existing PID-file check — no regression."
    - "On flush failure the next cycle waits at least 10s and at most 300s with ±25% jitter; on success the next cycle waits 10s ±25%."
    - "Process restart resets backoff to base (10s) — no persisted backoff state."
  artifacts:
    - path: "mcp/src/cli/util/daemon-supervisor.ts"
      provides: "checkSupervisor() — two-tier exit-code probe (launchctl print on macOS; systemctl --user is-active on Linux); returns SupervisorStatus"
      exports: ["checkSupervisor"]
    - path: "mcp/src/capture/daemon.ts"
      provides: "DaemonManager.isRunning() with supervisor-first detection; startHandoffLoop with self-rescheduling setTimeout + exponential backoff + jitter"
      contains: "checkSupervisor"
    - path: "mcp/src/cli/commands.ts"
      provides: "runCaptureStatus output that distinguishes supervised vs PID-only daemons"
      contains: "supervised by"
  key_links:
    - from: "mcp/src/capture/daemon.ts (DaemonManager)"
      to: "mcp/src/cli/util/daemon-supervisor.ts (checkSupervisor)"
      via: "import + call before PID-file fallback"
      pattern: "checkSupervisor\\(\\)"
    - from: "mcp/src/cli/util/daemon-supervisor.ts"
      to: "mcp/src/capture/os-service.ts (LABEL constant)"
      via: "import — single source of truth for `app.synapsesync.daemon`"
      pattern: "app\\.synapsesync\\.daemon"
    - from: "mcp/src/capture/daemon.ts (startHandoffLoop)"
      to: "self-rescheduling setTimeout chain"
      via: "scheduleNext() recursion via setTimeout"
      pattern: "setTimeout\\(scheduleNext"
---

<objective>
Close BUG-02 (daemon detection under launchd / systemd) and BUGS.md #12 (exponential backoff with jitter on flush failures) in a single plan. These two share `mcp/src/capture/daemon.ts` so they must be sequenced in one plan to avoid file conflicts (per CONTEXT.md D-09 — "colocated edit with BUG-02 in the same file").

Purpose: After this plan, `synapse capture status` reports honest state for launchd-supervised daemons (closing the BUG-02 Acceptance row in REQUIREMENTS.md), and `~/.synapse/daemon.log` stops growing 6 lines/min during the current 1101 outage (closing BUGS.md #12).

Output: `daemon-supervisor.ts` filled in; `daemon.ts` rewired in two places (`isRunning()` body + `startHandoffLoop` body); `commands.ts` updated to surface "supervised by launchd|systemd" in the status output. 13 RED tests (4 BUG-02 + 5 BUGS.md #12 + 4 reused in `status.test.ts`) turn GREEN.

User-observable outcome (per MVP_MODE for a stabilization phase): a user runs `synapse capture status` on this dev machine and gets `Daemon: running · supervised by launchd · PID 96819` (or current PID), and `~/.synapse/daemon.log` stops growing during the 1101 outage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-stabilize-backend-observability/01-CONTEXT.md
@.planning/phases/01-stabilize-backend-observability/01-RESEARCH.md
@.planning/phases/01-stabilize-backend-observability/01-VALIDATION.md
@.planning/phases/01-stabilize-backend-observability/01-01-SUMMARY.md
@.planning/codebase/CONVENTIONS.md
@docs/BUGS.md

<interfaces>
<!-- Source-of-truth patterns. Extracted from RESEARCH.md Pattern 3 + Pattern 5. -->

`daemon-supervisor.ts` exports (created in Wave 0, body fills in this plan):
- `export type Supervisor = "launchd" | "systemd" | null`
- `export interface SupervisorStatus { running: boolean; pid: number | null; supervisor: Supervisor }`
- `export function checkSupervisor(): SupervisorStatus` — dispatches on `process.platform`; macOS → `launchctl print gui/$UID/<LABEL>`; Linux → `systemctl --user is-active synapsesync.service`; Windows / unknown → returns `{ running: false, pid: null, supervisor: null }`.

Launchd label (single source of truth):
- `mcp/src/capture/os-service.ts:26` — `app.synapsesync.daemon`. Import (or re-export) — do NOT redefine in `daemon-supervisor.ts`.

systemd service name (per RESEARCH §"Pattern 3"):
- `synapsesync.service` (must match what `os-service.ts` writes on Linux install — verify with grep before assuming).

Existing `isRunning()` body (BUG-02 fix site — `mcp/src/capture/daemon.ts:40-50`):
- Currently does only `readPid()` + `process.kill(pid, 0)`. Keep this as tier-2 fallback. Insert supervisor check FIRST.

Existing `startHandoffLoop` body (BUGS.md #12 fix site — `mcp/src/capture/daemon.ts:131-179`):
- Currently `setInterval(cycle, Math.min(pull_ms, flush_ms))`. Replace the main interval with a self-rescheduling `setTimeout`. Leave the `flush-now` signal `setInterval(_, 100)` poll AND the healthcheck `setInterval(_, hc_ms)` ALONE (per RESEARCH §"Pattern 5" + Anti-Pattern "DON'T re-add backoff state to `runFlushCycle`").

Existing `runCaptureStatus` (BUG-02 surface — `mcp/src/cli/commands.ts`):
- Greps for the function definition; the current implementation prints "Daemon: running" / "Daemon: stopped" based on `isRunning()`. Extend output to print the supervisor tag and PID when available (use the new `status()` accessor — see action).

LANDMINES (RESEARCH §"Common Pitfalls"):
- Pitfall 1: DO NOT pipe `launchctl print` output — execSync must run the command directly to get the real exit code. Verified empirically.
- Pitfall 5: `process.getuid()` is undefined on Windows. Guard with `process.platform === "darwin"` first.
- Pitfall 4: Backoff at 5-min cap can mask a real outage. Out of scope for this plan (D-10 defers log surfacing); leave a TODO comment in `startHandoffLoop` referencing BUGS.md #12 follow-up so slice 1b reviewers see it.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement checkSupervisor() in daemon-supervisor.ts</name>
  <files>mcp/src/cli/util/daemon-supervisor.ts</files>
  <read_first>
    - mcp/src/cli/util/daemon-supervisor.ts (Wave 0 stub — full)
    - mcp/src/capture/os-service.ts (lines 1-50, lines 100-140 — for the `LABEL` constant + `resolveDaemonScriptPath` pattern reference)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 3" (lines 317-390)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Common Pitfalls" (Pitfall 1, Pitfall 5)
    - mcp/test/cli/status.test.ts (full — Wave 0 extensions describe expected behavior)
    - .planning/codebase/CONVENTIONS.md
  </read_first>
  <behavior>
    - On `process.platform === "darwin"`: call `execSync("launchctl print gui/${uid}/${LABEL}", { stdio: ["ignore","pipe","ignore"], encoding: "utf-8" })`. If it returns, parse `/^\s*pid\s*=\s*(\d+)/m` from stdout and return `{ running: true, pid: <number|null>, supervisor: "launchd" }`. If it throws (non-zero exit, including 113 for "service not found"), return `{ running: false, pid: null, supervisor: null }` (tier-2 PID fallback happens in the caller, not here).
    - On `process.platform === "linux"`: call `execSync("systemctl --user is-active synapsesync.service", ...)`. If stdout trim is exactly `"active"`, query `systemctl --user show -p MainPID --value synapsesync.service` for the PID, parse, return `{ running: true, pid, supervisor: "systemd" }`. Otherwise / on throw, return `{ running: false, pid: null, supervisor: null }`.
    - On any other platform (`win32`, etc.): return `{ running: false, pid: null, supervisor: null }` without invoking `process.getuid` (Pitfall 5 guard).
    - DO NOT pipe (Pitfall 1). Use execSync directly with stdio config above.
    - Import `LABEL` from `mcp/src/capture/os-service.ts` per Wave 0 re-export (single source of truth — A4 in RESEARCH §"Assumptions Log"). If `os-service.ts` does not currently export `LABEL`, add a named export there in this same task (1 LOC).
  </behavior>
  <action>
    Replace the Wave 0 stub body of `checkSupervisor()` with the platform-dispatch logic described under `<behavior>`. Reference RESEARCH §"Pattern 3" for the exact shape; do not inline that pattern's code block here — write it once in this source file. Import `execSync` from `node:child_process`. If `mcp/src/capture/os-service.ts` does not yet export `LABEL` as a named export, add `export const LABEL = "app.synapsesync.daemon";` (move the existing local constant to a named export — verify the existing literal at line 26 matches first, do not change the string value). Wrap each execSync call in try/catch — never let an exception escape `checkSupervisor`.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/status.test.ts</automated>
  </verify>
  <done>4 BUG-02 rows in 01-VALIDATION.md "Per-Task Verification Map" flip from ⬜ to ✅; the launchd success / failure / fallback / output-tagging tests pass; `npm run lint && npm run typecheck` exit 0 from repo root.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire checkSupervisor into DaemonManager.isRunning + update status output</name>
  <files>mcp/src/capture/daemon.ts, mcp/src/cli/commands.ts</files>
  <read_first>
    - mcp/src/capture/daemon.ts (full — note line 40-50 isRunning() and line 131-179 startHandoffLoop)
    - mcp/src/cli/commands.ts (grep for `runCaptureStatus` — read that function + 20 lines surrounding)
    - mcp/src/cli/util/daemon-supervisor.ts (now-implemented checkSupervisor)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 3" lines 374-390 (status() accessor shape)
    - .planning/phases/01-stabilize-backend-observability/01-CONTEXT.md §"specifics" — output format guidance
    - mcp/test/cli/status.test.ts (Wave 0 extensions — read the assertions verbatim)
  </read_first>
  <behavior>
    - Add a new method `DaemonManager.status(): { running: boolean; pid: number | null; supervisor: Supervisor }` that calls `checkSupervisor()` first; if `running` is true, returns it; otherwise falls back to the existing PID-file + `process.kill(pid, 0)` check (current `isRunning()` body) and returns `{ running, pid, supervisor: null }`.
    - Refactor `isRunning(): boolean` to delegate: `return this.status().running`.
    - In `mcp/src/cli/commands.ts:runCaptureStatus`, switch from `isRunning()` to `status()` and format the output: when `supervisor === "launchd"` print "Daemon: running · supervised by launchd · PID <n>"; same for `systemd`. When `supervisor === null` and `running === true` print "Daemon: running · PID <n>". When `running === false` keep the existing "Daemon: stopped" message.
    - Per D-09, leave a single-line TODO comment near the `runCaptureStatus` output referencing "BUGS.md #12 follow-up: surface last successful flush + current backoff once daemon.log readback lands" — explicitly OUT of scope here.
  </behavior>
  <action>
    Edit `mcp/src/capture/daemon.ts`: add the new `status()` method to `DaemonManager` (signature in `<behavior>`), refactor `isRunning()` to return `this.status().running`. Preserve the existing PID-file cleanup behavior (`this.cleanup()` when `process.kill(pid, 0)` throws) inside the tier-2 branch. Import `checkSupervisor` and `Supervisor` from `../cli/util/daemon-supervisor`.

    Edit `mcp/src/cli/commands.ts`: in `runCaptureStatus`, replace the `isRunning()` call with `status()`, format the three output cases per `<behavior>`. Use existing logger / `console.log` pattern already in that function (do not introduce a new logger). Add the one-line BUGS.md #12 follow-up TODO comment.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/status.test.ts</automated>
  </verify>
  <done>Status test BUG-02 row 4 (output distinguishes supervised vs PID) flips ✅. `isRunning()` retains backwards-compatible boolean return so other callers (existing tests, hook-dispatch.ts, etc.) need no change.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Replace setInterval with self-rescheduling setTimeout + exponential backoff in startHandoffLoop</name>
  <files>mcp/src/capture/daemon.ts</files>
  <read_first>
    - mcp/src/capture/daemon.ts (lines 131-179 — current startHandoffLoop body)
    - mcp/src/capture/handoff-sync.ts (lines 30-80 — runFlushCycle throw path)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 5" (lines 482-566)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Common Pitfalls" Pitfall 4
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Anti-Patterns" lines 567-576
    - mcp/test/capture/daemon-backoff.test.ts (Wave 0 — read assertions)
    - docs/BUGS.md #12 fix sketch
  </read_first>
  <behavior>
    - Replace `setInterval(cycle, Math.min(pull_ms, flush_ms))` with a closure-scoped `scheduleNext()` that awaits one `cycle()`, updates `currentDelay` (×2 on cycle returning false / OR all-projects-failed; reset to BASE_DELAY on success), clamps to MAX_DELAY=300_000, applies multiplicative jitter `currentDelay * (0.75 + Math.random() * 0.5)`, and calls `setTimeout(scheduleNext, jitteredDelay)`.
    - `cycle()` returns boolean — true if every project's flush+pull completed without an error, false otherwise (the existing `console.error("[handoff] cycle error", ...)` log stays in the catch; this surface is what determines `ok`).
    - Keep the `flush-now` signal `setInterval(_, 100)` UNCHANGED — it MUST NOT participate in backoff (user-initiated, per Anti-Pattern note).
    - Keep the healthcheck `setInterval(_, hc_ms)` UNCHANGED.
    - Backoff state (`currentDelay`, `consecutiveFailures`, `nextTimer`) is CLOSURE-SCOPED in `startHandoffLoop` — never written to disk (rationale: RESEARCH §"Pattern 5" "Why loop-scoped is correct" + `events.jsonl` append-only semantics from `<code_context>`).
    - Returned cleanup function must clear `nextTimer` (via `clearTimeout`) AND both interval handles, AND set `stopped = true` so any in-flight `scheduleNext` exits early.
    - Leave a one-line code comment near `MAX_DELAY = 300_000` documenting the deliberate ceiling (per Pitfall 4: "300s cap is the deliberate ceiling — masks long outages by design; surfacing deferred to BUGS.md #12 follow-up").
  </behavior>
  <action>
    Replace `startHandoffLoop` body per RESEARCH §"Pattern 5" code shape (lines 488-558). Do NOT inline that pattern verbatim into this plan — write the implementation in the source file directly. Preserve the existing per-project flush/pull/writeBrief logic inside `cycle()` (lines ~138-160 of current body). Preserve the canonical_project_id swap. Preserve `flushNowSignalPath()` and `healthcheckPath()` usage. The pre-existing `setInterval(_, 100)` and `setInterval(_, hc_ms)` calls stay textually identical; only the main scheduling loop changes.

    Add the deliberate-ceiling comment near `MAX_DELAY`. Add a defensive `if (stopped) return` at the top of `scheduleNext` per Anti-Pattern note.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/capture/daemon-backoff.test.ts</automated>
    <automated>cd mcp && npx vitest run test/capture/</automated>
  </verify>
  <done>All 5 BUGS.md #12 rows in 01-VALIDATION.md flip ✅; existing capture tests in `mcp/test/capture/` still pass; `npm run lint && npm run typecheck` exit 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user shell → child process (launchctl/systemctl) | The execSync calls invoke fixed system binaries with no user-controlled arguments — the LABEL constant and service name are compile-time literals. Trust assumption: the system binaries themselves are trustworthy. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02-01 | Information Disclosure | `checkSupervisor` execSync stderr | mitigate | `stdio: ["ignore", "pipe", "ignore"]` discards stderr — no daemon-log noise from probe failures. |
| T-01-02-02 | Tampering | LABEL constant injection | accept | LABEL is a compile-time string literal exported from `os-service.ts`; not user-controllable. |
| T-01-02-03 | Denial of Service | Thundering-herd retry against backend on recovery | mitigate | ±25% jitter on each backoff step (per RESEARCH §"Pattern 5" — AWS Architecture Blog 2015 reference). |
| T-01-02-04 | Repudiation | Silent flush failures during backoff | accept | D-10 defers log surfacing; deliberate-ceiling comment documents it. Slice 1b adds health surfacing. |
</threat_model>

<verification>
1. `cd mcp && npx vitest run test/cli/status.test.ts test/capture/daemon-backoff.test.ts test/capture/handoff-sync.test.ts` — all green
2. `cd mcp && npx vitest run` — full mcp suite green (no regression in existing tests)
3. `npm run lint && npm run typecheck` from repo root — exit 0
4. Manual (not blocking, but the project intends this): run `synapse capture status` on the dev machine; expect `Daemon: running · supervised by launchd · PID <n>` (matches BUG-02 SC#2 from REQUIREMENTS.md, deferred manual verification per VALIDATION.md "Manual-Only Verifications").
</verification>

<success_criteria>
- BUG-02 acceptance row in REQUIREMENTS.md is closable: `synapse capture status` reports "Daemon: running" with launchd-supervised PID when the daemon is alive under launchd.
- BUGS.md #12 fix sketch implemented; daemon log no longer grows ~6 lines/min during a backend outage (verifiable post-merge by tailing `~/.synapse/daemon.log` for 5min during the current 1101 outage — manual).
- 9 RED tests turn GREEN (4 BUG-02 + 5 BUGS.md #12).
- No new disk artifacts under `~/.synapse/` (per D-10).
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-02-SUMMARY.md` when done. Summary MUST update VALIDATION.md row statuses (4 BUG-02 + 5 BUGS.md #12 rows from ⬜ → ✅) and note the BUG-02 manual verification (`synapse capture status` output) was/wasn't performed on the dev machine.
</output>
