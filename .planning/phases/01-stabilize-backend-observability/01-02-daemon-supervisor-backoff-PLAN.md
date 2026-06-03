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
  - mcp/src/capture/daemon-backoff.ts
  - mcp/src/cli/commands.ts
autonomous: true
requirements: [BUG-02, BUGS-MD-12]

must_haves:
  truths:
    - "When the launchd-supervised daemon is running on macOS, `synapse capture status` reports 'Daemon: running' and tags 'supervised by launchd' with the launchd-reported PID."
    - "When the daemon is unsupervised (or launchctl reports the label is not loaded), `isRunning()` falls back to the existing PID-file check — no regression."
    - "On flush failure the next cycle waits at least 10s and at most 300s with ±25% jitter; on success the next cycle waits 10s ±25%."
    - "Process restart resets backoff to base (10s) — no persisted backoff state."
    - "Backoff math lives in a pure helper `computeNextDelay(prevDelayMs, lastSucceeded)` in `mcp/src/capture/daemon-backoff.ts` — tested without timers."
  artifacts:
    - path: "mcp/src/cli/util/daemon-supervisor.ts"
      provides: "checkSupervisor() — two-tier exit-code probe (launchctl print on macOS; systemctl --user is-active on Linux); returns SupervisorStatus"
      exports: ["checkSupervisor"]
    - path: "mcp/src/capture/daemon-backoff.ts"
      provides: "Pure helper `computeNextDelay(prevDelayMs, lastSucceeded)` + `BASE_DELAY_MS` + `MAX_DELAY_MS` constants. Imported by `daemon.ts`."
      exports: ["computeNextDelay", "BASE_DELAY_MS", "MAX_DELAY_MS"]
    - path: "mcp/src/capture/daemon.ts"
      provides: "DaemonManager.isRunning() with supervisor-first detection; startHandoffLoop with self-rescheduling setTimeout that calls computeNextDelay"
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
      to: "mcp/src/capture/os-service.ts (LAUNCHD_LABEL constant)"
      via: "import — single source of truth for `app.synapsesync.daemon` (export established by Plan 01-01 Task 3)"
      pattern: "LAUNCHD_LABEL"
    - from: "mcp/src/capture/daemon.ts (startHandoffLoop)"
      to: "mcp/src/capture/daemon-backoff.ts (computeNextDelay)"
      via: "import + call to compute next setTimeout delay"
      pattern: "computeNextDelay\\("
---

<objective>
Close BUG-02 (daemon detection under launchd / systemd) and BUGS.md #12 (exponential backoff with jitter on flush failures) in a single plan. These two share `mcp/src/capture/daemon.ts` so they must be sequenced in one plan to avoid file conflicts (per CONTEXT.md D-09 — "colocated edit with BUG-02 in the same file").

Purpose: After this plan, `synapse capture status` reports honest state for launchd-supervised daemons (closing the BUG-02 Acceptance row in REQUIREMENTS.md), and `~/.synapse/daemon.log` stops growing 6 lines/min during the current 1101 outage (closing BUGS.md #12).

Output: `daemon-supervisor.ts` filled in; `daemon-backoff.ts` filled in with the pure `computeNextDelay` math; `daemon.ts` rewired in two places (`isRunning()` body + `startHandoffLoop` body — the latter now calls `computeNextDelay`); `commands.ts` updated to surface "supervised by launchd|systemd" in the status output. 13 RED tests (4 BUG-02 + 5 BUGS.md #12 against the pure helper + 4 reused in `status.test.ts`) turn GREEN.

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
- `export function checkSupervisor(): SupervisorStatus` — dispatches on `process.platform`; macOS → `launchctl print gui/$UID/<LAUNCHD_LABEL>`; Linux → `systemctl --user is-active synapsesync.service`; Windows / unknown → returns `{ running: false, pid: null, supervisor: null }`.

`daemon-backoff.ts` exports (stub created in Wave 0, body fills in this plan):
- `export const BASE_DELAY_MS = 10_000`
- `export const MAX_DELAY_MS = 300_000`
- `export function computeNextDelay(prevDelayMs: number, lastSucceeded: boolean): number` — pure function. No side effects. No I/O. No `Date.now()`. The ONLY source of non-determinism is `Math.random()` used for jitter. This isolation is the BLOCKER #5 fix: `daemon-backoff.test.ts` tests this helper directly without `vi.useFakeTimers()`, eliminating collision with the two preserved `setInterval` calls in `startHandoffLoop`.

Launchd label (single source of truth — established by Plan 01-01 Task 3):
- `mcp/src/capture/os-service.ts` exports `LAUNCHD_LABEL`. Import it directly — DO NOT redefine the literal in `daemon-supervisor.ts`. The Wave 0 export is guaranteed to exist by the time Wave 2 runs (Plan 01-01 is a hard dependency of this plan).

systemd service name (per RESEARCH §"Pattern 3"):
- `synapsesync.service` (must match what `os-service.ts` writes on Linux install — verify with grep before assuming).

Existing `isRunning()` body (BUG-02 fix site — `mcp/src/capture/daemon.ts:40-50`):
- Currently does only `readPid()` + `process.kill(pid, 0)`. Keep this as tier-2 fallback. Insert supervisor check FIRST.

Existing `startHandoffLoop` body (BUGS.md #12 fix site — `mcp/src/capture/daemon.ts:131-179`):
- Currently `setInterval(cycle, Math.min(pull_ms, flush_ms))`. Replace the main interval with a self-rescheduling `setTimeout` that delegates the delay math to `computeNextDelay`. The `flush-now` signal `setInterval(_, 100)` and the healthcheck `setInterval(_, hc_ms)` stay UNCHANGED — per RESEARCH §"Pattern 5" + Anti-Pattern "DON'T re-add backoff state to `runFlushCycle`". This is why the helper is pure: testing it does not need to drive or mock either preserved interval.

Existing `runCaptureStatus` (BUG-02 surface — `mcp/src/cli/commands.ts`):
- Greps for the function definition; the current implementation prints "Daemon: running" / "Daemon: stopped" based on `isRunning()`. Extend output to print the supervisor tag and PID when available (use the new `status()` accessor — see action).

Existing capture tests that MUST remain green after this plan (from `ls mcp/test/capture/*.test.ts`):
- `mcp/test/capture/crash-resilience.test.ts`
- `mcp/test/capture/daemon-cc.test.ts`
- `mcp/test/capture/daemon.test.ts`
- `mcp/test/capture/events-log.test.ts`
- `mcp/test/capture/handoff-brief.test.ts`
- `mcp/test/capture/handoff-paths.test.ts`
- `mcp/test/capture/handoff-sync.test.ts`
- `mcp/test/capture/heuristic-synth.test.ts`
- `mcp/test/capture/idle-trigger.test.ts`
- `mcp/test/capture/os-service.test.ts` (already verifies the LAUNCHD_LABEL refactor from Plan 01-01)
- `mcp/test/capture/sandbox.test.ts`

LANDMINES (RESEARCH §"Common Pitfalls"):
- Pitfall 1: DO NOT pipe `launchctl print` output — execSync must run the command directly to get the real exit code. Verified empirically.
- Pitfall 5: `process.getuid()` is undefined on Windows. Guard with `process.platform === "darwin"` first.
- Pitfall 4: Backoff at 5-min cap can mask a real outage. Out of scope for this plan (D-10 defers log surfacing); leave a code comment near `MAX_DELAY_MS` referencing BUGS.md #12 follow-up so slice 1b reviewers see it. WARNING #10 fix: the comment MUST contain BOTH the string `MAX_DELAY` (or `max delay`) AND a reference to either `deliberate` or `BUGS.md #12`, so a grep can verify the rationale survives future refactors.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement checkSupervisor() in daemon-supervisor.ts</name>
  <files>mcp/src/cli/util/daemon-supervisor.ts</files>
  <read_first>
    - mcp/src/cli/util/daemon-supervisor.ts (Wave 0 stub — full)
    - mcp/src/capture/os-service.ts (full — read the LAUNCHD_LABEL export established by Plan 01-01 Task 3, and the `resolveDaemonScriptPath` pattern for style reference)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 3" (lines 317-390)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Common Pitfalls" (Pitfall 1, Pitfall 5)
    - mcp/test/cli/status.test.ts (full — Wave 0 extensions describe expected behavior)
    - .planning/codebase/CONVENTIONS.md
  </read_first>
  <behavior>
    - On `process.platform === "darwin"`: call `execSync("launchctl print gui/${uid}/${LAUNCHD_LABEL}", { stdio: ["ignore","pipe","ignore"], encoding: "utf-8" })`. If it returns, parse `/^\s*pid\s*=\s*(\d+)/m` from stdout and return `{ running: true, pid: <number|null>, supervisor: "launchd" }`. If it throws (non-zero exit, including 113 for "service not found"), return `{ running: false, pid: null, supervisor: null }` (tier-2 PID fallback happens in the caller, not here).
    - On `process.platform === "linux"`: call `execSync("systemctl --user is-active synapsesync.service", ...)`. If stdout trim is exactly `"active"`, query `systemctl --user show -p MainPID --value synapsesync.service` for the PID, parse, return `{ running: true, pid, supervisor: "systemd" }`. Otherwise / on throw, return `{ running: false, pid: null, supervisor: null }`.
    - On any other platform (`win32`, etc.): return `{ running: false, pid: null, supervisor: null }` without invoking `process.getuid` (Pitfall 5 guard).
    - DO NOT pipe (Pitfall 1). Use execSync directly with stdio config above.
    - Import `LAUNCHD_LABEL` from `../../capture/os-service` (single source of truth — Plan 01-01 Task 3 guarantees it exists). DO NOT redefine the literal in this file.
  </behavior>
  <action>
    Replace the Wave 0 stub body of `checkSupervisor()` with the platform-dispatch logic described under `<behavior>`. Reference RESEARCH §"Pattern 3" for the exact shape; do not inline that pattern's code block here — write it once in this source file. Import `execSync` from `node:child_process` and `LAUNCHD_LABEL` from `../../capture/os-service` (match existing import-path conventions in the mcp workspace — `.js` extension or no extension as the rest of the file uses). Wrap each execSync call in try/catch — never let an exception escape `checkSupervisor`.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/status.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - VALIDATION row: BUG-02 / "returns true when launchctl print reports the label loaded" → `cd mcp && npx vitest run test/cli/status.test.ts -t "returns true when launchctl print reports the label loaded"` exits 0.
    - VALIDATION row: BUG-02 / "returns false when launchctl print throws (service not loaded)" → `cd mcp && npx vitest run test/cli/status.test.ts -t "returns false when launchctl print throws"` exits 0.
    - VALIDATION row: BUG-02 / "falls back to PID-file check on non-supervisor platforms" → `cd mcp && npx vitest run test/cli/status.test.ts -t "falls back to PID-file check"` exits 0.
    - Import correctness: `grep -nE "from .*os-service" mcp/src/cli/util/daemon-supervisor.ts | grep -q "LAUNCHD_LABEL"` exits 0 (the file imports the named export, does not redefine the literal).
    - No redefined label: `grep -cE '"app\.synapsesync\.daemon"' mcp/src/cli/util/daemon-supervisor.ts` returns exactly 0.
    - `npm run lint && npm run typecheck` exit 0 from repo root.
  </acceptance_criteria>
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
  <acceptance_criteria>
    - VALIDATION row: BUG-02 / "capture status output distinguishes 'supervised by launchd/systemd' from 'alive via PID'" → `cd mcp && npx vitest run test/cli/status.test.ts -t "supervised by launchd"` exits 0.
    - `DaemonManager.isRunning()` retains boolean return: `grep -nE "isRunning\\(\\):\\s*boolean" mcp/src/capture/daemon.ts` returns exactly 1 hit (callers in hook-dispatch.ts etc. need no change).
    - `DaemonManager.status()` method exists: `grep -nE "status\\(\\):\\s*\\{" mcp/src/capture/daemon.ts` returns at least 1 hit.
    - Output strings present: `grep -cE "supervised by launchd" mcp/src/cli/commands.ts` returns ≥ 1; `grep -cE "supervised by systemd" mcp/src/cli/commands.ts` returns ≥ 1.
    - Follow-up TODO: `grep -nE "BUGS\\.md #12" mcp/src/cli/commands.ts` returns at least 1 hit (the deferred-log-surfacing comment).
    - All existing tests pass: `cd mcp && npx vitest run` exits 0 (after Tasks 1+2+3 — but partial verify after Task 2 is acceptable if Task 3 hasn't landed yet; the wave-end check covers full).
  </acceptance_criteria>
  <done>Status test BUG-02 row 4 (output distinguishes supervised vs PID) flips ✅. `isRunning()` retains backwards-compatible boolean return so other callers (existing tests, hook-dispatch.ts, etc.) need no change.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Implement computeNextDelay in daemon-backoff.ts + wire it into startHandoffLoop</name>
  <files>mcp/src/capture/daemon-backoff.ts, mcp/src/capture/daemon.ts</files>
  <read_first>
    - mcp/src/capture/daemon-backoff.ts (Wave 0 stub — full)
    - mcp/src/capture/daemon.ts (lines 131-179 — current startHandoffLoop body)
    - mcp/src/capture/handoff-sync.ts (lines 30-80 — runFlushCycle throw path)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 5" (lines 482-566)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Common Pitfalls" Pitfall 4
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Anti-Patterns" lines 567-576
    - mcp/test/capture/daemon-backoff.test.ts (Wave 0 — read assertions verbatim; the tests target the pure `computeNextDelay` helper, not the loop)
    - docs/BUGS.md #12 fix sketch
  </read_first>
  <behavior>
    Part A — pure helper in `daemon-backoff.ts`:
    - Implement `computeNextDelay(prevDelayMs: number, lastSucceeded: boolean): number` as a pure function:
        - If `lastSucceeded === true`: `target = BASE_DELAY_MS`.
        - Else: `target = Math.min(MAX_DELAY_MS, prevDelayMs * 2)`.
        - Apply jitter: `return target * (0.75 + Math.random() * 0.5)` (multiplicative ±25%).
    - No side effects. No timers. No I/O. Only `Math.random()` for jitter.
    - Constants `BASE_DELAY_MS = 10_000` and `MAX_DELAY_MS = 300_000` are already exported by the Wave 0 stub — confirm and keep.
    - Add a code comment IMMEDIATELY above `export const MAX_DELAY_MS = 300_000;` reading exactly: `// MAX_DELAY_MS is the deliberate 5-minute ceiling; masks long outages by design (BUGS.md #12 follow-up: surface backoff state via daemon.log readback in slice 1b).` This comment is the WARNING #10 grep target — it must contain BOTH `MAX_DELAY` AND either `deliberate` or `BUGS.md #12`.

    Part B — wire into `startHandoffLoop` in `daemon.ts`:
    - Replace `setInterval(cycle, Math.min(pull_ms, flush_ms))` with a closure-scoped `scheduleNext()` chain:
        1. Track `currentDelay` (initialized to `BASE_DELAY_MS`) and `stopped` (initialized to `false`) in the closure scope.
        2. `scheduleNext()` awaits one `cycle()` call. `cycle()` returns boolean — true if every project's flush+pull completed without an error, false otherwise (the existing `console.error("[handoff] cycle error", ...)` log stays in the catch; this surface is what determines `ok`).
        3. After `cycle()` returns, compute `currentDelay = computeNextDelay(currentDelay, ok)` (imported from `./daemon-backoff`).
        4. If `stopped` is true, return without scheduling.
        5. Otherwise `nextTimer = setTimeout(scheduleNext, currentDelay)`.
    - Add a defensive `if (stopped) return;` at the very top of `scheduleNext` (per Anti-Pattern note).
    - Keep the `flush-now` signal `setInterval(_, 100)` UNCHANGED — it MUST NOT participate in backoff (user-initiated).
    - Keep the healthcheck `setInterval(_, hc_ms)` UNCHANGED.
    - Backoff state (`currentDelay`, `nextTimer`, `stopped`) is CLOSURE-SCOPED in `startHandoffLoop` — never written to disk (rationale: RESEARCH §"Pattern 5" "Why loop-scoped is correct" + `events.jsonl` append-only semantics).
    - Returned cleanup function must clear `nextTimer` (via `clearTimeout`) AND both interval handles, AND set `stopped = true` so any in-flight `scheduleNext` exits early.
  </behavior>
  <action>
    Edit `mcp/src/capture/daemon-backoff.ts`: replace the Wave 0 stub body of `computeNextDelay` with the pure-math implementation from `<behavior>` Part A. Confirm `BASE_DELAY_MS` and `MAX_DELAY_MS` exports are present and unchanged. Insert the rationale comment immediately above `MAX_DELAY_MS` exactly as specified.

    Edit `mcp/src/capture/daemon.ts`: import `computeNextDelay`, `BASE_DELAY_MS` from `./daemon-backoff`. Replace `startHandoffLoop` body per RESEARCH §"Pattern 5" code shape (lines 488-558) but delegate the delay math to `computeNextDelay`. Preserve the existing per-project flush/pull/writeBrief logic inside `cycle()` (lines ~138-160 of current body). Preserve the canonical_project_id swap. Preserve `flushNowSignalPath()` and `healthcheckPath()` usage. The pre-existing `setInterval(_, 100)` and `setInterval(_, hc_ms)` calls stay textually identical; only the main scheduling loop changes.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/capture/daemon-backoff.test.ts</automated>
    <automated>cd mcp && npx vitest run test/capture/</automated>
    <automated>grep -E "MAX_DELAY|max.*delay" mcp/src/capture/daemon-backoff.ts | grep -E "deliberate|BUGS.md #12"</automated>
  </verify>
  <acceptance_criteria>
    - VALIDATION row: BUGS.md #12 / "Backoff starts at base delay (10s)" → `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts -t "returns BASE_DELAY_MS"` exits 0.
    - VALIDATION row: BUGS.md #12 / "Backoff doubles on each failure (10→20→40→80→160→300)" → `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts -t "doubles prevDelayMs"` exits 0.
    - VALIDATION row: BUGS.md #12 / "Backoff caps at MAX_DELAY (300s)" → `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts -t "caps at MAX_DELAY_MS"` exits 0.
    - VALIDATION row: BUGS.md #12 / "Backoff resets to base on first success" → `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts -t "resets to BASE_DELAY_MS"` exits 0.
    - VALIDATION row: BUGS.md #12 / "Jitter is within ±25% of the current delay" → `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts -t "jitter is multiplicative"` exits 0.
    - Rationale comment survives: `grep -E "MAX_DELAY|max.*delay" mcp/src/capture/daemon-backoff.ts | grep -qE "deliberate|BUGS.md #12"` exits 0.
    - All other capture tests still green: `cd mcp && npx vitest run test/capture/` exits 0 (covers `crash-resilience.test.ts`, `daemon-cc.test.ts`, `daemon.test.ts`, `events-log.test.ts`, `handoff-brief.test.ts`, `handoff-paths.test.ts`, `handoff-sync.test.ts`, `heuristic-synth.test.ts`, `idle-trigger.test.ts`, `os-service.test.ts`, `sandbox.test.ts` — enumerated from `ls mcp/test/capture/*.test.ts`).
    - `computeNextDelay` is pure: `grep -E "setTimeout|setInterval|Date\\.now|process\\." mcp/src/capture/daemon-backoff.ts | grep -v '^//'` returns 0 lines (no side-effect APIs in the backoff module body, ignoring comments).
    - `startHandoffLoop` uses it: `grep -nE "computeNextDelay\\(" mcp/src/capture/daemon.ts` returns at least 1 hit.
    - Preserved intervals: `grep -cE "setInterval\\(" mcp/src/capture/daemon.ts` returns exactly 2 (the flush-now signal poll and the healthcheck — NOT a third for the main loop).
    - `npm run lint && npm run typecheck` exit 0.
  </acceptance_criteria>
  <done>All 5 BUGS.md #12 rows in 01-VALIDATION.md flip ✅; existing capture tests in `mcp/test/capture/` (enumerated above: crash-resilience, daemon-cc, daemon, events-log, handoff-brief, handoff-paths, handoff-sync, heuristic-synth, idle-trigger, os-service, sandbox) still pass; `npm run lint && npm run typecheck` exit 0; the rationale comment near MAX_DELAY_MS contains both `MAX_DELAY` and `BUGS.md #12`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user shell → child process (launchctl/systemctl) | The execSync calls invoke fixed system binaries with no user-controlled arguments — the LAUNCHD_LABEL constant and service name are compile-time literals. Trust assumption: the system binaries themselves are trustworthy. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02-01 | Information Disclosure | `checkSupervisor` execSync stderr | mitigate | `stdio: ["ignore", "pipe", "ignore"]` discards stderr — no daemon-log noise from probe failures. |
| T-01-02-02 | Tampering | LAUNCHD_LABEL constant injection | accept | LAUNCHD_LABEL is a compile-time string literal exported from `os-service.ts` (established in Plan 01-01 Task 3); not user-controllable. |
| T-01-02-03 | Denial of Service | Thundering-herd retry against backend on recovery | mitigate | ±25% jitter on each `computeNextDelay` return (per RESEARCH §"Pattern 5" — AWS Architecture Blog 2015 reference). |
| T-01-02-04 | Repudiation | Silent flush failures during backoff | accept | D-10 defers log surfacing; rationale comment near MAX_DELAY_MS documents the deliberate-ceiling behavior. Slice 1b adds health surfacing. |
</threat_model>

<verification>
1. `cd mcp && npx vitest run test/cli/status.test.ts test/capture/daemon-backoff.test.ts test/capture/handoff-sync.test.ts` — all green
2. `cd mcp && npx vitest run` — full mcp suite green (no regression in existing tests: `daemon.test.ts`, `daemon-cc.test.ts`, `handoff-sync.test.ts`, `crash-resilience.test.ts`, `events-log.test.ts`, `handoff-brief.test.ts`, `handoff-paths.test.ts`, `heuristic-synth.test.ts`, `idle-trigger.test.ts`, `os-service.test.ts`, `sandbox.test.ts`)
3. `npm run lint && npm run typecheck` from repo root — exit 0
4. `grep -E "MAX_DELAY|max.*delay" mcp/src/capture/daemon.ts mcp/src/capture/daemon-backoff.ts | grep -E "deliberate|BUGS.md #12"` — at least 1 match in `daemon-backoff.ts` (the rationale comment)
5. Manual (not blocking, but the project intends this): run `synapse capture status` on the dev machine; expect `Daemon: running · supervised by launchd · PID <n>` (matches BUG-02 SC#2 from REQUIREMENTS.md, deferred manual verification per VALIDATION.md "Manual-Only Verifications").
</verification>

<success_criteria>
- BUG-02 acceptance row in REQUIREMENTS.md is closable: `synapse capture status` reports "Daemon: running" with launchd-supervised PID when the daemon is alive under launchd.
- BUGS.md #12 fix sketch implemented; daemon log no longer grows ~6 lines/min during a backend outage (verifiable post-merge by tailing `~/.synapse/daemon.log` for 5min during the current 1101 outage — manual).
- 9 RED tests turn GREEN (4 BUG-02 + 5 BUGS.md #12). The BUGS.md #12 tests run against the pure `computeNextDelay` helper, not the full `startHandoffLoop` — no fake-timer collision with preserved `setInterval` calls.
- No new disk artifacts under `~/.synapse/` (per D-10).
- The rationale comment near `MAX_DELAY_MS` survives — grep-checkable per acceptance criteria of Task 3.
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-02-SUMMARY.md` when done. Summary MUST update VALIDATION.md row statuses (4 BUG-02 + 5 BUGS.md #12 rows from ⬜ → ✅) and note the BUG-02 manual verification (`synapse capture status` output) was/wasn't performed on the dev machine.
</output>
