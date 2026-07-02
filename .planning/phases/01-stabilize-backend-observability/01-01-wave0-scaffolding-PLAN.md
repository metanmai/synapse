---
phase: 01-stabilize-backend-observability
plan: 01
type: execute
wave: 1
slice: 1a
depends_on: []
files_modified:
  - mcp/test/cli/mcp-command.test.ts
  - mcp/test/capture/daemon-backoff.test.ts
  - backend/test/lib/observability.test.ts
  - backend/test/lib/observability-wiring.test.ts
  - mcp/test/cli/init.test.ts
  - mcp/test/cli/status.test.ts
  - mcp/test/capture/os-service.test.ts
  - mcp/src/cli/util/mcp-command.ts
  - mcp/src/cli/util/daemon-supervisor.ts
  - mcp/src/capture/daemon-backoff.ts
  - backend/src/lib/observability.ts
  - mcp/src/capture/os-service.ts
autonomous: true
requirements: [BUG-02, BUG-03, BUG-04, OBS-01, BUGS-MD-12]

must_haves:
  truths:
    - "Every Wave 2 task has a failing test that pins down the expected behavior before production code is touched."
    - "No production source files in Wave 2 need to be created from scratch — the stubs already exist with the right exports."
    - "`mcp/src/capture/os-service.ts` exports `LAUNCHD_LABEL` as the single source of truth for the launchd label; the plist template references it (the existing `os-service.test.ts` plist-content assertions and a new runtime-export assertion together prove this)."
    - "`mcp/src/capture/daemon-backoff.ts` exports a pure `computeNextDelay(prevDelayMs, lastSucceeded)` helper so backoff math can be unit-tested without driving real or fake timers through `startHandoffLoop`'s setInterval calls."
  artifacts:
    - path: "mcp/test/cli/mcp-command.test.ts"
      provides: "RED tests for BUG-03 resolver branches (which / dist / npx fallback) + proxy probe timeout"
      contains: "resolveSynapseMcpCommand"
    - path: "mcp/test/capture/daemon-backoff.test.ts"
      provides: "RED tests for BUGS.md #12 backoff schedule by testing the pure `computeNextDelay` helper directly (base, doubling, cap, reset, jitter ±25%) — NO fake timers, NO loop driving"
      contains: "computeNextDelay"
    - path: "backend/test/lib/observability.test.ts"
      provides: "RED tests for OBS-01 scrubPayload (event.extra, breadcrumbs, request.data, no-op when no synapse shape)"
      contains: "scrubPayload"
    - path: "backend/test/lib/observability-wiring.test.ts"
      provides: "RED test asserting backend/src/index.ts contains `app.use(sentry(` before CORS"
      contains: "sentry"
    - path: "mcp/test/capture/os-service.test.ts"
      provides: "Extended (do not rewrite): adds runtime-import assertion that `LAUNCHD_LABEL === 'app.synapsesync.daemon'` AND a render-equivalence assertion that `renderLaunchdPlist(...)` output contains `<string>app.synapsesync.daemon</string>` exactly once. Together these guard the bug class 'label is a single source of truth, importable, and the plist renders the same string' without depending on source-text shape."
      contains: "LAUNCHD_LABEL"
    - path: "mcp/src/cli/util/mcp-command.ts"
      provides: "Stub exporting resolveSynapseMcpCommand + probeNpmRegistry (throws Not Implemented)"
      exports: ["resolveSynapseMcpCommand", "probeNpmRegistry"]
    - path: "mcp/src/cli/util/daemon-supervisor.ts"
      provides: "Stub exporting checkSupervisor (throws Not Implemented)"
      exports: ["checkSupervisor"]
    - path: "mcp/src/capture/daemon-backoff.ts"
      provides: "Stub exporting `computeNextDelay(prevDelayMs, lastSucceeded): number` (throws Not Implemented). Plan 01-02 fills the body."
      exports: ["computeNextDelay"]
    - path: "backend/src/lib/observability.ts"
      provides: "Stub exporting scrubPayload (throws Not Implemented)"
      exports: ["scrubPayload"]
    - path: "mcp/src/capture/os-service.ts"
      provides: "Named export `LAUNCHD_LABEL = 'app.synapsesync.daemon'`; plist template references it (no behavioral change)"
      contains: "LAUNCHD_LABEL"
  key_links:
    - from: "Wave 2 production tasks"
      to: "Wave 1 test files"
      via: "vitest test discovery"
      pattern: "test files exist before production code change"
    - from: "Plan 01-02 daemon-supervisor.ts"
      to: "mcp/src/capture/os-service.ts (LAUNCHD_LABEL)"
      via: "import — single source of truth"
      pattern: "import.*LAUNCHD_LABEL.*os-service"
---

<objective>
Wave 0 (Nyquist) scaffolding for slice 1a. Create the 4 new test files referenced by 01-VALIDATION.md with at least one RED (failing) test each, extend 3 existing test files (`init.test.ts`, `status.test.ts`, `os-service.test.ts`) with placeholders for the new BUG-02 / BUG-04 branches and the LAUNCHD_LABEL invariant, stub the 4 new production files (`mcp-command.ts`, `daemon-supervisor.ts`, `daemon-backoff.ts`, `observability.ts`) with their exported signatures so Wave 2 plans can import without TypeScript errors, AND lift the launchd label out of `mcp/src/capture/os-service.ts` as a named export `LAUNCHD_LABEL` so Wave 2's `daemon-supervisor.ts` can import a single source of truth.

Purpose: Wave 2 (4 parallel implementation plans) cannot start until every failing test exists, per Nyquist validation contract. Stubs also let Wave 2 tasks edit a single file each without circular import / type-resolution churn. The `LAUNCHD_LABEL` export and the `computeNextDelay` extraction together eliminate two checker-flagged risks: shadowed-string drift and fake-timer pollution from preserved `setInterval` calls.

Output: 6 test files (4 new + 2 extended via `init.test.ts` and `status.test.ts`), `os-service.test.ts` extended with a runtime invariant for `LAUNCHD_LABEL`, 4 stub source files, and 1 surgical edit to `os-service.ts` (extract launchd label as named export, template-string the plist), all committed in a single batch. The pre-push hook runs once (per CONTEXT.md "pre-push hook fires ~25s") — `test` will report N failing tests; `lint && typecheck` must pass. We intentionally let the test step fail until Wave 2 lands.

This plan is **scaffolding-only** — it has no user-observable outcome on its own. The Wave 2 plans (02, 03, 04, 05) deliver the user-observable outcomes for SC#2 (daemon status surfacing), SC#3 (wizard `.mcp.json`), and the code half of SC#4 (Sentry wiring).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-stabilize-backend-observability/01-CONTEXT.md
@.planning/phases/01-stabilize-backend-observability/01-RESEARCH.md
@.planning/phases/01-stabilize-backend-observability/01-VALIDATION.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/TESTING.md

<interfaces>
<!-- Patterns the executor MUST mirror. Extracted from RESEARCH.md Pattern 1-5 + Code Examples. -->

Existing test patterns to mirror:
- `mcp/test/capture/handoff-sync.test.ts:7-16` — tmpdir + SYNAPSE_HOME override (beforeEach / afterEach)
- `mcp/test/unit/browser-auth.test.ts:114-123` — vi.useFakeTimers + advanceTimersByTimeAsync (NOTE: not used for daemon-backoff tests in this plan — see Task 2 behavior)
- `mcp/test/cli/init.test.ts` — existing init test layout (extend, do not rewrite)
- `mcp/test/cli/status.test.ts` — existing status test layout (extend)
- `mcp/test/capture/os-service.test.ts` — existing os-service test layout (extend with a small `describe("LAUNCHD_LABEL invariant")` block; do not modify existing assertions)

Stub export shapes (Wave 2 plans depend on these):
- `mcp/src/cli/util/mcp-command.ts` MUST export:
    - `export interface McpCommand { command: string; args: string[]; env: Record<string, string> }`
    - `export function resolveSynapseMcpCommand(apiKey: string): McpCommand` (sync per RESEARCH §"Open Questions" #3)
    - `export async function probeNpmRegistry(timeoutMs?: number): Promise<boolean>`
- `mcp/src/cli/util/daemon-supervisor.ts` MUST export:
    - `export type Supervisor = "launchd" | "systemd" | null`
    - `export interface SupervisorStatus { running: boolean; pid: number | null; supervisor: Supervisor }`
    - `export function checkSupervisor(): SupervisorStatus`
- `mcp/src/capture/daemon-backoff.ts` MUST export:
    - `export const BASE_DELAY_MS = 10_000`
    - `export const MAX_DELAY_MS = 300_000`
    - `export function computeNextDelay(prevDelayMs: number, lastSucceeded: boolean): number` — pure function, no side effects, no timers. Wave 2 Plan 01-02 fills the body and wires it into `startHandoffLoop`.
- `backend/src/lib/observability.ts` MUST export:
    - `export function scrubPayload(event: unknown, hint?: unknown): unknown` (loose-typed in stub; Wave 2 imports `Event, EventHint` from `@sentry/cloudflare` and tightens)

Phase-1 launchd label (single source of truth — this plan establishes it):
- BEFORE this plan: `mcp/src/capture/os-service.ts:26` contains the inline literal `<string>app.synapsesync.daemon</string>` inside the plist template (no named export).
- AFTER Task 3 of this plan: `mcp/src/capture/os-service.ts` exports `export const LAUNCHD_LABEL = "app.synapsesync.daemon"` near the top of the file. The plist template at line 26 references it via template-literal interpolation: `<key>Label</key><string>${LAUNCHD_LABEL}</string>`. The literal string value `app.synapsesync.daemon` MUST be byte-identical pre/post edit so existing installs are unaffected. Wave 2 Plan 01-02 imports `LAUNCHD_LABEL` from `os-service.ts` (no re-definition).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Stub the 4 new production files with typed exports</name>
  <files>mcp/src/cli/util/mcp-command.ts, mcp/src/cli/util/daemon-supervisor.ts, mcp/src/capture/daemon-backoff.ts, backend/src/lib/observability.ts</files>
  <read_first>
    - .planning/phases/01-stabilize-backend-observability/01-CONTEXT.md (full)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 3" (lines 317-390 — daemon-supervisor shape), §"Pattern 4" (lines 392-480 — mcp-command shape), §"Pattern 2" (lines 267-316 — scrubPayload shape), §"Pattern 5" (lines 482-566 — backoff math)
    - .planning/phases/01-stabilize-backend-observability/01-VALIDATION.md §"Wave 0 Requirements"
    - mcp/src/cli/init.ts (full) — read existing util import conventions
    - .planning/codebase/CONVENTIONS.md (TypeScript conventions)
  </read_first>
  <behavior>
    - Each stub file compiles under `npm run typecheck` from repo root.
    - Each exported function throws `new Error("not implemented — Wave 2")` when called at runtime so test files can `expect(fn).toThrow()` if needed during RED step. EXCEPTION: `BASE_DELAY_MS` and `MAX_DELAY_MS` constants in `daemon-backoff.ts` have real values from Wave 0 (the tests assert against them); only `computeNextDelay` throws.
    - No new dependencies installed (mcp workspace gets zero new deps per RESEARCH §"Standard Stack"). `backend/src/lib/observability.ts` stub uses `unknown` for Sentry types — the import of `@sentry/cloudflare` types is deferred to Plan 05 to keep this plan dependency-free.
  </behavior>
  <action>
    Create `mcp/src/cli/util/mcp-command.ts` exporting the `McpCommand` interface, a sync `resolveSynapseMcpCommand(apiKey)` that throws "not implemented — Wave 2", and an async `probeNpmRegistry(timeoutMs?)` that throws. Use the export shape from `<interfaces>` above; do not implement logic in this task. Create `mcp/src/cli/util/daemon-supervisor.ts` exporting the `Supervisor` type, `SupervisorStatus` interface, and a `checkSupervisor()` that throws "not implemented — Wave 2". Create `mcp/src/capture/daemon-backoff.ts` exporting `BASE_DELAY_MS = 10_000`, `MAX_DELAY_MS = 300_000`, and a `computeNextDelay(prevDelayMs, lastSucceeded)` that throws "not implemented — Wave 2". Create `backend/src/lib/observability.ts` exporting a `scrubPayload(event, hint?)` stub that throws "not implemented — Wave 2"; types are `unknown` for now (Plan 05 will tighten to `Event` / `EventHint` from `@sentry/cloudflare` after the install task lands). No `Sentry.init` in this stub. Follow CONVENTIONS.md TS style (named exports, JSDoc-free, no `default export`).
  </action>
  <verify>
    <automated>npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f mcp/src/cli/util/mcp-command.ts && grep -q 'export function resolveSynapseMcpCommand' mcp/src/cli/util/mcp-command.ts && grep -q 'export async function probeNpmRegistry' mcp/src/cli/util/mcp-command.ts`
    - File exists: `test -f mcp/src/cli/util/daemon-supervisor.ts && grep -q 'export function checkSupervisor' mcp/src/cli/util/daemon-supervisor.ts`
    - File exists: `test -f mcp/src/capture/daemon-backoff.ts && grep -qE 'export const BASE_DELAY_MS\s*=\s*10_?000' mcp/src/capture/daemon-backoff.ts && grep -qE 'export const MAX_DELAY_MS\s*=\s*300_?000' mcp/src/capture/daemon-backoff.ts && grep -q 'export function computeNextDelay' mcp/src/capture/daemon-backoff.ts`
    - File exists: `test -f backend/src/lib/observability.ts && grep -q 'export function scrubPayload' backend/src/lib/observability.ts`
    - `npm run typecheck` exits 0 from repo root
    - `npm run lint` exits 0 from repo root
    - Each exported function (except the two constants) throws when called: `cd mcp && node -e "require('./src/cli/util/mcp-command').resolveSynapseMcpCommand('x')"` exits non-zero with the "not implemented — Wave 2" message in stderr.
  </acceptance_criteria>
  <done>All 4 files exist; `npm run typecheck` exits 0 from repo root; `npm run lint` exits 0; runtime call of any stub function throws "not implemented — Wave 2".</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create 4 new RED test files + extend 3 existing test files (init, status, os-service)</name>
  <files>mcp/test/cli/mcp-command.test.ts, mcp/test/capture/daemon-backoff.test.ts, backend/test/lib/observability.test.ts, backend/test/lib/observability-wiring.test.ts, mcp/test/cli/init.test.ts, mcp/test/cli/status.test.ts, mcp/test/capture/os-service.test.ts</files>
  <read_first>
    - .planning/phases/01-stabilize-backend-observability/01-VALIDATION.md §"Per-Task Verification Map" (every row)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Code Examples" (lines 635-722)
    - mcp/test/capture/handoff-sync.test.ts (lines 1-50) — tmpdir test pattern
    - mcp/test/cli/init.test.ts (full) — existing structure to extend
    - mcp/test/cli/status.test.ts (full) — existing structure to extend
    - mcp/test/capture/os-service.test.ts (full) — existing structure to extend with the LAUNCHD_LABEL invariant block
    - .planning/codebase/TESTING.md
  </read_first>
  <behavior>
    For each VALIDATION.md row, write a test that NAMES the expected behavior in its `it()` description and CALLS the (currently-stubbed) function. These tests MUST FAIL on Wave 1 (because the stubs throw "not implemented") and PASS as Wave 2 lands each implementation.

    `mcp-command.test.ts` cases (BUG-03):
      - it("resolves to absolute bin path when `which synapsesync` succeeds") — mocks `child_process.execSync` to return "/usr/local/bin/synapsesync" and `fs.existsSync` true, asserts `command` equals that path and `args` is empty.
      - it("resolves to `node <abs>/dist/index.js` when which fails but dist exists") — mocks `execSync` to throw, `fs.existsSync` true on dist path, asserts `command === process.execPath` and `args[0]` ends with `dist/index.js`.
      - it("returns `npx synapsesync` last-resort when neither resolves") — mocks `execSync` throw + `fs.existsSync` false, asserts `command === "npx"` and `args === ["synapsesync"]`.
      - it("probeNpmRegistry returns false on 2s timeout") — mocks `fetch` to never resolve (returns a never-settling Promise), `vi.useFakeTimers()`, advances by 2001ms, asserts result is `false`.

    `daemon-backoff.test.ts` cases (BUGS.md #12) — tests the **pure helper** `computeNextDelay(prevDelayMs, lastSucceeded): number`. NO fake timers, NO loop driving, NO `setInterval` collisions. Each case is a direct call → numeric assertion:
      - it("returns BASE_DELAY_MS ± 25% jitter when lastSucceeded is true (any prevDelayMs)") — call `computeNextDelay(40_000, true)` 200 times (loop), assert every return ∈ [7500, 12500]; assert that across 200 samples both the min < 9000 and the max > 11000 (sanity check that jitter is actually applied, not a fixed value).
      - it("doubles prevDelayMs when lastSucceeded is false") — `computeNextDelay(10_000, false)` returns ∈ [15000, 25000] (i.e., 20_000 ± 25%); `computeNextDelay(40_000, false)` returns ∈ [60000, 100000]; assert across 200 samples per case.
      - it("caps at MAX_DELAY_MS (300s) ± 25% upper bound") — `computeNextDelay(200_000, false)` returns ∈ [225000, 375000] (i.e., min(400_000, 300_000) = 300_000 ± 25%); also assert with `computeNextDelay(1_000_000, false)` that the unjittered cap is 300_000 (max return < 375_001).
      - it("resets to BASE_DELAY_MS band on success after a long backoff") — `computeNextDelay(300_000, true)` returns ∈ [7500, 12500].
      - it("jitter is multiplicative ±25% — range [0.75x, 1.25x] of the pre-jitter target") — for prevDelayMs=80_000, lastSucceeded=false, target=160_000, assert across 500 samples that every return ∈ [120000, 200000], and that observed min < 130000 and observed max > 190000.

    `observability.test.ts` cases (OBS-01 scrubPayload):
      - it("removes event.extra[k].payload from synapse-shaped event objects") — input event with `extra: { ev: { event_id: "x", kind: "tool_used", payload: { secret: "y" } } }`, asserts output has no `.payload` key.
      - it("preserves stack traces and request metadata") — input has `exception`, `request: { url, method }`, asserts those are unchanged.
      - it("returns the same event when no synapse-shaped data is attached") — input has only standard Sentry fields, asserts deep equality with input.
      - it("removes event.request.data and event.breadcrumbs[*].data.payload") — covers the Hono body-capture path.

    `observability-wiring.test.ts` (OBS-01 wiring assertion):
      - it("backend/src/index.ts calls app.use(sentry(...)) BEFORE CORS") — reads `backend/src/index.ts` from disk as text. Strips comments using this exact algorithm (per WARNING #7 fix):
          1. Strip block comments globally with the regex `/\*[\s\S]*?\*/` (replace with empty string).
          2. Split the remaining text into lines. For each line, find the first non-whitespace character; if that character is `/` AND the next character is also `/`, drop the line entirely. Keep all other lines (including lines where `//` appears mid-line in a string literal — for this test that's an acceptable false positive because string literals containing `//` are vanishingly rare in `index.ts` and the assertion only cares about top-level `app.use(...)` patterns).
          3. Join the kept lines back with `\n` to form `stripped`.
      - Then assert two things:
          (a) `stripped.includes("app.use(sentry(")` is true.
          (b) The first occurrence index of `app.use(` in `stripped` equals the first occurrence index of `app.use(sentry(` in `stripped` — i.e., no other `app.use(...)` precedes `app.use(sentry(...)`.
      - This test is module-level — does not require importing the real app.

    `init.test.ts` extensions (BUG-04) — append, do not rewrite:
      - it("writes a new .mcp.json in cwd with the synapse server entry") — uses existing tmpdir pattern with `SYNAPSE_HOME` override, also `process.chdir(tmp)`, runs `runInit({ api_key: "test" })`, asserts `${tmp}/.mcp.json` exists and contains `mcpServers.synapse`.
      - it("merges into an existing .mcp.json preserving other server entries") — seeds `${tmp}/.mcp.json` with `{ mcpServers: { cursor: { command: "x" } } }`, runs `runInit`, asserts both `cursor` and `synapse` are present.
      - it("backs up and rewrites an invalid existing .mcp.json") — seeds an unparseable file, runs `runInit`, asserts `.mcp.json.bak` exists with original content (per existing `writeMcpJson` corrupt path).
      - it("calls ensureGitignore(cwd, '.mcp.json') whenever cwd .mcp.json is written") — spies on `ensureGitignore` and asserts called with the cwd path and `.mcp.json` arg.

    `status.test.ts` extensions (BUG-02) — append, do not rewrite:
      - it("returns true when launchctl print reports the label loaded") — mocks `execSync` to return a stdout containing `pid = 12345`, asserts `DaemonManager.isRunning()` is true and the status surface tags supervisor as `launchd`.
      - it("returns false when launchctl print throws (service not loaded)") — mocks `execSync` to throw with exit 113, asserts `isRunning()` returns false.
      - it("falls back to PID-file check on non-supervisor platforms") — mocks `process.platform = "win32"`, asserts the PID-file branch runs (existing tier-2 behavior).
      - it("capture status distinguishes launchd, systemd, and PID-only outputs from each other") — invokes `runCaptureStatus` (or the equivalent status-surface function exported from `mcp/src/cli/commands.ts`) three times with the supervisor module mocked to return three different shapes: `{ supervisor: "launchd", pid: 12345, running: true }`, `{ supervisor: "systemd", pid: 67890, running: true }`, and `{ supervisor: null, pid: 11111, running: true }`. Capture stdout for each. Assert: (a) all three captured outputs are pairwise distinct (no two equal), (b) the launchd output contains both the substring "launchd" AND "12345", (c) the systemd output contains both "systemd" AND "67890", (d) the PID-only output contains "11111" AND does NOT contain either "launchd" or "systemd". The exact phrasing ("supervised by", "via PID", etc.) is free to drift; the **distinguishability + supervisor-name + PID-presence** invariants are what catch the bug class.
      - it("daemon-supervisor invokes launchctl with the LAUNCHD_LABEL imported from os-service (not a redefined literal)") — `vi.mock("../../src/capture/os-service", () => ({ LAUNCHD_LABEL: "TEST_SENTINEL_LABEL", renderLaunchdPlist: vi.fn(), renderSystemdUnit: vi.fn() }))` (or whatever exports the real file has — extend the mock to preserve other exports if needed). Spy on `child_process.execSync`. Call `checkSupervisor()` on a darwin-mocked platform. Assert the execSync call's first argument contains the substring `TEST_SENTINEL_LABEL`. If the supervisor inlined a hard-coded label literal, the call would contain `app.synapsesync.daemon` instead and this test fails. This is the class-correct guard for "daemon-supervisor.ts must import LAUNCHD_LABEL, not redefine it."

    `os-service.test.ts` extensions (LAUNCHD_LABEL invariant — appended, existing assertions untouched):
      - Add a `describe("LAUNCHD_LABEL invariant", () => { ... })` block at the end of the file:
          - it("exports LAUNCHD_LABEL as a runtime constant equal to 'app.synapsesync.daemon'") — `import { LAUNCHD_LABEL } from "../../src/capture/os-service"; expect(LAUNCHD_LABEL).toBe("app.synapsesync.daemon");`. This is class-correct: any rename, refactor, or accidental shadowing of the constant will fail this. The literal string value is the contract — Plan 01-02 imports this same identifier.
          - it("renderLaunchdPlist output contains the LAUNCHD_LABEL string exactly once") — call `renderLaunchdPlist({ node: "/n", script: "/s", log: "/l" })` (or whatever ServiceTemplate shape the existing tests use), assert the rendered string contains `<string>app.synapsesync.daemon</string>` exactly once (use a regex with a global flag + `match()?.length === 1`). This is the render-equivalence invariant — proves the label flows from the constant into the plist body. If someone refactors the template or accidentally double-renders, this fails. (Existing `os-service.test.ts` assertions about other plist content remain untouched and serve as the broader behavioral regression guard.)
  </behavior>
  <action>
    Write all 4 new test files at the paths above, mirroring the tmpdir + helper-import patterns from RESEARCH §"Code Examples". For `daemon-backoff.test.ts`, import `computeNextDelay`, `BASE_DELAY_MS`, `MAX_DELAY_MS` from `../../src/capture/daemon-backoff` and call the pure function directly — DO NOT use `vi.useFakeTimers`, DO NOT drive `startHandoffLoop` from this test (this is the WARNING #5 / BLOCKER #5 fix). For the 3 existing files (`init.test.ts`, `status.test.ts`, `os-service.test.ts`), APPEND new `describe(...)` blocks; do not modify existing tests. Each test imports from the Task-1 stub paths (`mcp/src/cli/util/mcp-command`, `mcp/src/cli/util/daemon-supervisor`, `mcp/src/capture/daemon-backoff`, `backend/src/lib/observability`). All tests should reference behaviors verbatim from VALIDATION.md "Per-Task Verification Map" rows so the row → test mapping is one-line greppable. DO NOT skip any test (no `.skip` / `it.skip`); they MUST be RED until Wave 2 lands.

    For `observability-wiring.test.ts`, implement the comment-stripping algorithm specified in `<behavior>` step (a)/(b)/(c) literally. Do not invent a different stripping approach; the algorithm avoids the comment-gate self-invalidation pitfall.

    For the `status.test.ts` "daemon-supervisor uses LAUNCHD_LABEL" test, use `vi.mock` to substitute a sentinel value at module load; the test fails if `daemon-supervisor.ts` hard-codes the literal `app.synapsesync.daemon` instead of importing the constant. Note: this test depends on Wave 2's `checkSupervisor` implementation (it will be RED until Plan 01-02 Task 1 lands; that is correct per Nyquist).

    For the `os-service.test.ts` extension, append the `describe("LAUNCHD_LABEL invariant")` block with both `it(...)` cases. These tests RUN ONLY after Task 3 lands (Wave 0 batch) — they pass immediately within this plan as soon as the LAUNCHD_LABEL export exists, so they are GREEN at the end of Plan 01-01 (unlike the BUG-02/03/04/OBS-01 tests which stay RED until Wave 2).
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/mcp-command.test.ts test/cli/status.test.ts test/cli/init.test.ts test/capture/daemon-backoff.test.ts test/capture/os-service.test.ts 2>&1 | grep -E "(Tests|FAIL|pass)" | tail -10</automated>
    <automated>cd backend && npx vitest run test/lib/observability.test.ts test/lib/observability-wiring.test.ts 2>&1 | grep -E "(Tests|FAIL|pass)" | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - VALIDATION row: BUG-03 / "resolves to absolute bin path when `which synapsesync` succeeds" → `cd mcp && npx vitest run test/cli/mcp-command.test.ts -t "resolves to absolute bin path when"` reports the test as FAILING (RED step).
    - VALIDATION row: BUG-03 / "probeNpmRegistry returns false on 2s timeout" → same command + `-t "probeNpmRegistry returns false on 2s timeout"` reports FAILING.
    - VALIDATION row: BUGS.md #12 / "Backoff starts at base delay (10s)" → `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts -t "returns BASE_DELAY_MS"` reports FAILING.
    - VALIDATION row: BUGS.md #12 / "Backoff doubles on each failure" → same + `-t "doubles prevDelayMs"` reports FAILING.
    - VALIDATION row: BUGS.md #12 / "Backoff caps at MAX_DELAY (300s)" → same + `-t "caps at MAX_DELAY_MS"` reports FAILING.
    - VALIDATION row: BUG-02 / "returns true when launchctl print reports the label loaded" → `cd mcp && npx vitest run test/cli/status.test.ts -t "returns true when launchctl print reports the label loaded"` reports FAILING.
    - VALIDATION row: BUG-04 / "writes a new .mcp.json in cwd" → `cd mcp && npx vitest run test/cli/init.test.ts -t "writes a new .mcp.json"` reports FAILING.
    - VALIDATION row: OBS-01 / "removes event.extra[k].payload" → `cd backend && npx vitest run test/lib/observability.test.ts -t "removes event.extra"` reports FAILING.
    - VALIDATION row: OBS-01 (wiring) / "app.use(sentry(...)) BEFORE CORS" → `cd backend && npx vitest run test/lib/observability-wiring.test.ts` reports FAILING (the assertion will fail because `app.use(sentry(` isn't in `backend/src/index.ts` until Plan 05).
    - LAUNCHD_LABEL runtime invariant (passes after Task 3 of this plan): `cd mcp && npx vitest run test/capture/os-service.test.ts -t "exports LAUNCHD_LABEL as a runtime constant"` exits 0 once Task 3 lands.
    - LAUNCHD_LABEL render-equivalence (passes after Task 3 of this plan): `cd mcp && npx vitest run test/capture/os-service.test.ts -t "renderLaunchdPlist output contains the LAUNCHD_LABEL string exactly once"` exits 0 once Task 3 lands.
    - All 7 affected test files exist on disk and are syntactically valid: `cd mcp && npx vitest run test/cli/mcp-command.test.ts test/capture/daemon-backoff.test.ts test/cli/init.test.ts test/cli/status.test.ts test/capture/os-service.test.ts 2>&1 | grep -q "Tests"` exits 0 (vitest reports test counts rather than refusing to load); `cd backend && npx vitest run test/lib/observability.test.ts test/lib/observability-wiring.test.ts 2>&1 | grep -q "Tests"` exits 0.
    - `npm run lint` exits 0 from repo root; `npm run typecheck` exits 0 from repo root.
    - No `.skip` / `it.skip` / `describe.skip` strings appear in the new test files: `grep -rE "\.skip\b" mcp/test/cli/mcp-command.test.ts mcp/test/capture/daemon-backoff.test.ts backend/test/lib/observability.test.ts backend/test/lib/observability-wiring.test.ts | wc -l` returns 0.
  </acceptance_criteria>
  <done>All 7 affected files exist; `npx vitest run` shows the expected failures (BUG-02: 5 failing now including the LAUNCHD_LABEL-via-sentinel test, BUG-03: 4 failing, BUG-04: 4 failing, BUGS.md #12: 5 failing, OBS-01: 4 failing scrubPayload + 1 failing wiring = 23 RED tests total per VALIDATION.md map) plus the 2 os-service LAUNCHD_LABEL-invariant tests that turn GREEN immediately after Task 3 lands; `npm run lint && npm run typecheck` exit 0 from repo root.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Extract LAUNCHD_LABEL as a named export from os-service.ts</name>
  <files>mcp/src/capture/os-service.ts</files>
  <read_first>
    - mcp/src/capture/os-service.ts (full — currently the literal `app.synapsesync.daemon` is inlined in the plist template at line 26 inside `renderLaunchdPlist`; there is NO named export for the label as of the start of this plan)
    - mcp/test/capture/os-service.test.ts (full — read what it asserts about the rendered plist so the template-literal swap doesn't regress any existing assertion; this is also the file extended in Task 2 with the LAUNCHD_LABEL invariant block)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Runtime State Inventory" (single source of truth for the launchd label)
  </read_first>
  <behavior>
    - Add `export const LAUNCHD_LABEL = "app.synapsesync.daemon";` near the top of `mcp/src/capture/os-service.ts` (just after the imports, above `ServiceTemplate`).
    - Replace the inline literal `<string>app.synapsesync.daemon</string>` inside `renderLaunchdPlist`'s template literal (currently around line 26) with `<string>${LAUNCHD_LABEL}</string>`.
    - The string value `app.synapsesync.daemon` MUST be byte-identical before and after the edit — `renderLaunchdPlist(...)` output for any given `ServiceTemplate` must produce the same plist text as today. The existing `mcp/test/capture/os-service.test.ts` assertions about the rendered plist AND the new LAUNCHD_LABEL-invariant assertions appended in Task 2 MUST all pass.
    - Name the constant `LAUNCHD_LABEL` (not `LABEL`) per BLOCKER 2 fix — more specific name avoids accidental shadowing when callers import it.
    - This task is NOT TDD — it's a refactor that preserves observable behavior. The bug class ("label is a single source of truth, importable, and the plist renders the same string") is guarded by two runtime invariants in `os-service.test.ts` (added in Task 2) PLUS all pre-existing plist-content assertions in that file. No grep-on-source-text checks — those are theater per `feedback_test_generality.md`.
  </behavior>
  <action>
    Edit `mcp/src/capture/os-service.ts`: insert `export const LAUNCHD_LABEL = "app.synapsesync.daemon";` directly after the import block (above the `ServiceTemplate` interface). In `renderLaunchdPlist`'s template literal, change the line `  <key>Label</key><string>app.synapsesync.daemon</string>` to `  <key>Label</key><string>${LAUNCHD_LABEL}</string>`. Do not modify any other line of the file. Do not change the `Label` key spelling, casing, or surrounding XML. Do not touch `renderSystemdUnit` or the install helpers.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/capture/os-service.test.ts</automated>
    <automated>npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - Behavioral invariant (class-correct, replaces three previous source-text greps): `cd mcp && npx vitest run test/capture/os-service.test.ts -t "exports LAUNCHD_LABEL as a runtime constant equal to"` exits 0 — the constant is importable and equals the expected literal. This catches any rename, deletion, or value drift of the constant regardless of source-text shape (single-quote vs double-quote, template literal, re-export from another module, etc.).
    - Render-equivalence invariant (class-correct): `cd mcp && npx vitest run test/capture/os-service.test.ts -t "renderLaunchdPlist output contains the LAUNCHD_LABEL string exactly once"` exits 0 — the plist body still embeds the label exactly once (no double-render, no missing label, no accidental replacement).
    - Full `os-service.test.ts` suite green: `cd mcp && npx vitest run test/capture/os-service.test.ts` exits 0 — pre-existing plist-content assertions still pass, proving the rendered plist text is byte-identical pre/post edit.
    - Cross-plan integration prerequisite: Plan 01-02 Task 1's "daemon-supervisor invokes launchctl with the LAUNCHD_LABEL imported from os-service" test (added in Task 2 of this plan) is now well-formed — `vi.mock("../../src/capture/os-service", ...)` can substitute the runtime export.
    - `npm run typecheck` exits 0 from repo root.
    - **Reviewer-checklist item (manual, not automated — per `feedback_test_generality.md` "if the bug has no executable surface, prefer dropping the test + adding a reviewer-checklist item over inventing ceremonial grep coverage"):** the reviewer of this plan's commit must confirm visually that (a) `mcp/src/capture/os-service.ts` contains exactly one `export const LAUNCHD_LABEL = "app.synapsesync.daemon";` near the top of the file, and (b) the plist template uses template-literal interpolation (`${LAUNCHD_LABEL}`) instead of a duplicated literal. The runtime invariants above catch the bug class; this checklist item catches duplicated-source-literal regressions that are syntactically equivalent to the correct form (e.g., a careless future edit that re-inlines `app.synapsesync.daemon` alongside the template ref).
  </acceptance_criteria>
  <done>`LAUNCHD_LABEL` is a top-level named export; the plist template references it; `renderLaunchdPlist` output is unchanged; the LAUNCHD_LABEL runtime invariant + render-equivalence invariant + all pre-existing `os-service.test.ts` assertions pass; `npm run typecheck` exits 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none in this plan) | Wave 0 is test scaffolding + stubs + a label-extraction refactor. No new code paths, no inputs, no network surface. Trust boundaries are introduced by the Wave 2 plans (OBS-01 introduces the Sentry SDK transport; BUG-03 introduces a 2-second fetch to registry.npmjs.org). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-SC | Tampering | npm install (none in this plan) | n/a | This plan installs zero packages. Sentry installs occur in Plan 05; the `@sentry/hono` legitimacy checkpoint lives there per RESEARCH §"Package Legitimacy Audit". |
| T-01-01-01 | Tampering | Refactored `os-service.ts` plist string | mitigate | The LAUNCHD_LABEL runtime invariant + render-equivalence invariant (Task 2 additions to `os-service.test.ts`) plus all pre-existing `os-service.test.ts` plist-content assertions together prove the rendered plist text is byte-identical pre/post edit; these guard the bug class without depending on source-text shape. |
</threat_model>

<verification>
After all three tasks complete:
1. `npm run lint` exits 0 (repo root)
2. `npm run typecheck` exits 0 (repo root) — proves stubs compile and tests type-check against them
3. `cd mcp && npx vitest run` shows ≥18 failing tests in slice-1a test files (5 BUG-02 including the LAUNCHD_LABEL-sentinel test + 4 BUG-03 + 4 BUG-04 + 5 BUGS.md #12) AND `os-service.test.ts` ALL-GREEN (pre-existing + LAUNCHD_LABEL invariant + render-equivalence — the label-refactor regression guard)
4. `cd backend && npx vitest run` shows ≥5 failing tests in `backend/test/lib/observability*.test.ts`
5. Failures all reference the "not implemented — Wave 2" stub throws — confirming the RED step.
6. The LAUNCHD_LABEL runtime invariant (`cd mcp && npx vitest run test/capture/os-service.test.ts -t "exports LAUNCHD_LABEL"`) exits 0 — proves the named export is importable.

Pre-push hook will run on commit; expected outcome: lint pass, typecheck pass, test FAIL (intentional). Push with the hook running once at the wave boundary per CONTEXT.md guidance — commit locally, push to `tanmain/synapse` after Wave 2 lands. (Alternatively: commit + `git push --no-verify` for the wave-0 commit only, then push normally after Wave 2. Operator's call.)
</verification>

<success_criteria>
- All 12 file paths in `files_modified` exist on disk with the contents described.
- VALIDATION.md "Wave 0 Requirements" checklist can be ticked: 4 new test files exist, 3 existing test files extended (`init.test.ts`, `status.test.ts`, `os-service.test.ts`).
- Wave 2 plans (02, 03, 04, 05) can each touch their owned files without needing to also create supporting test or stub files.
- 23 RED tests are queued for Wave 2, mapped to the VALIDATION.md "Per-Task Verification Map" rows that Wave 2 will turn green. Plus 2 invariant tests in `os-service.test.ts` (LAUNCHD_LABEL runtime + render-equivalence) that turn GREEN immediately after Task 3 lands within this plan.
- `LAUNCHD_LABEL` is the single source of truth for the launchd label — Plan 01-02 imports it; the BUG-02 "daemon-supervisor uses LAUNCHD_LABEL" sentinel test (in `status.test.ts`) catches the bug class "supervisor hard-coded the literal instead of importing."
- **Scaffolding-only — no user-observable outcome on its own; Wave 2 plans satisfy SC#2 (BUG-02 status surfacing) and SC#3 (BUG-03 `.mcp.json` shape).** Slice 1b satisfies SC#4 (Sentry deliberate-throw end-to-end) on the CF-enabled machine.
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-01-SUMMARY.md` when done. Note in the summary which VALIDATION.md rows are queued RED for Wave 2, confirm the LAUNCHD_LABEL runtime invariant + render-equivalence tests pass at the end of this plan, and confirm that `LAUNCHD_LABEL` is now exported from `os-service.ts`.
</output>
