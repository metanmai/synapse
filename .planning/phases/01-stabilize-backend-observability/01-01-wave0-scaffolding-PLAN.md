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
  - mcp/src/cli/util/mcp-command.ts
  - mcp/src/cli/util/daemon-supervisor.ts
  - backend/src/lib/observability.ts
autonomous: true
requirements: [BUG-02, BUG-03, BUG-04, OBS-01, BUGS-MD-12]

must_haves:
  truths:
    - "Every Wave 2 task has a failing test that pins down the expected behavior before production code is touched."
    - "No production source files in Wave 2 need to be created from scratch — the stubs already exist with the right exports."
  artifacts:
    - path: "mcp/test/cli/mcp-command.test.ts"
      provides: "RED tests for BUG-03 resolver branches (which / dist / npx fallback) + proxy probe timeout"
      contains: "resolveSynapseMcpCommand"
    - path: "mcp/test/capture/daemon-backoff.test.ts"
      provides: "RED tests for BUGS.md #12 backoff schedule (base, doubling, cap, reset, jitter ±25%)"
      contains: "useFakeTimers"
    - path: "backend/test/lib/observability.test.ts"
      provides: "RED tests for OBS-01 scrubPayload (event.extra, breadcrumbs, request.data, no-op when no synapse shape)"
      contains: "scrubPayload"
    - path: "backend/test/lib/observability-wiring.test.ts"
      provides: "RED test asserting backend/src/index.ts contains `app.use(sentry(` before CORS"
      contains: "sentry"
    - path: "mcp/src/cli/util/mcp-command.ts"
      provides: "Stub exporting resolveSynapseMcpCommand + probeNpmRegistry (throws Not Implemented)"
      exports: ["resolveSynapseMcpCommand", "probeNpmRegistry"]
    - path: "mcp/src/cli/util/daemon-supervisor.ts"
      provides: "Stub exporting checkSupervisor (throws Not Implemented)"
      exports: ["checkSupervisor"]
    - path: "backend/src/lib/observability.ts"
      provides: "Stub exporting scrubPayload (throws Not Implemented)"
      exports: ["scrubPayload"]
  key_links:
    - from: "Wave 2 production tasks"
      to: "Wave 1 test files"
      via: "vitest test discovery"
      pattern: "test files exist before production code change"
---

<objective>
Wave 0 (Nyquist) scaffolding for slice 1a. Create the 4 new test files referenced by 01-VALIDATION.md with at least one RED (failing) test each, extend 2 existing test files with placeholders for the new BUG-02 and BUG-04 branches, and stub the 3 new production files (`mcp-command.ts`, `daemon-supervisor.ts`, `observability.ts`) with their exported signatures so Wave 2 plans can import without TypeScript errors.

Purpose: Wave 2 (4 parallel implementation plans) cannot start until every failing test exists, per Nyquist validation contract. Stubs also let Wave 2 tasks edit a single file each without circular import / type-resolution churn.

Output: 6 test files (4 new + 2 extended) and 3 stub source files committed in a single batch. The pre-push hook runs once (per CONTEXT.md "pre-push hook fires ~25s") — `test` will report N failing tests; `lint && typecheck` must pass. We intentionally let the test step fail until Wave 2 lands.
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
- `mcp/test/unit/browser-auth.test.ts:114-123` — vi.useFakeTimers + advanceTimersByTimeAsync
- `mcp/test/cli/init.test.ts` — existing init test layout (extend, do not rewrite)
- `mcp/test/cli/status.test.ts` — existing status test layout (extend)

Stub export shapes (Wave 2 plans depend on these):
- `mcp/src/cli/util/mcp-command.ts` MUST export:
    - `export interface McpCommand { command: string; args: string[]; env: Record<string, string> }`
    - `export function resolveSynapseMcpCommand(apiKey: string): McpCommand` (sync per RESEARCH §"Open Questions" #3)
    - `export async function probeNpmRegistry(timeoutMs?: number): Promise<boolean>`
- `mcp/src/cli/util/daemon-supervisor.ts` MUST export:
    - `export type Supervisor = "launchd" | "systemd" | null`
    - `export interface SupervisorStatus { running: boolean; pid: number | null; supervisor: Supervisor }`
    - `export function checkSupervisor(): SupervisorStatus`
- `backend/src/lib/observability.ts` MUST export:
    - `export function scrubPayload(event: unknown, hint?: unknown): unknown` (loose-typed in stub; Wave 2 imports `Event, EventHint` from `@sentry/cloudflare` and tightens)

Phase-1 launchd label (single source of truth):
- `mcp/src/capture/os-service.ts:26` — `app.synapsesync.daemon` (DO NOT re-define; import or re-export)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Stub the 3 new production files with typed exports</name>
  <files>mcp/src/cli/util/mcp-command.ts, mcp/src/cli/util/daemon-supervisor.ts, backend/src/lib/observability.ts</files>
  <read_first>
    - .planning/phases/01-stabilize-backend-observability/01-CONTEXT.md (full)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 3" (lines 317-390 — daemon-supervisor shape), §"Pattern 4" (lines 392-480 — mcp-command shape), §"Pattern 2" (lines 267-316 — scrubPayload shape)
    - .planning/phases/01-stabilize-backend-observability/01-VALIDATION.md §"Wave 0 Requirements"
    - mcp/src/capture/os-service.ts (lines 1-30) — read existing `LABEL` constant
    - mcp/src/cli/init.ts (full) — read existing util import conventions
    - .planning/codebase/CONVENTIONS.md (TypeScript conventions)
  </read_first>
  <behavior>
    - Each stub file compiles under `npm run typecheck` from repo root.
    - Each exported function throws `new Error("not implemented — Wave 2")` when called at runtime so test files can `expect(fn).toThrow()` if needed during RED step.
    - No new dependencies installed (mcp workspace gets zero new deps per RESEARCH §"Standard Stack"). `backend/src/lib/observability.ts` stub uses `unknown` for Sentry types — the import of `@sentry/cloudflare` types is deferred to Plan 05 to keep this plan dependency-free.
  </behavior>
  <action>
    Create `mcp/src/cli/util/mcp-command.ts` exporting the `McpCommand` interface, a sync `resolveSynapseMcpCommand(apiKey)` that throws "not implemented — Wave 2", and an async `probeNpmRegistry(timeoutMs?)` that throws. Use the export shape from `<interfaces>` above; do not implement logic in this task. Create `mcp/src/cli/util/daemon-supervisor.ts` exporting the `Supervisor` type, `SupervisorStatus` interface, and a `checkSupervisor()` that throws "not implemented — Wave 2". Re-export the launchd label from `mcp/src/capture/os-service.ts` (per RESEARCH §"Runtime State Inventory" — single source of truth for `app.synapsesync.daemon`). Create `backend/src/lib/observability.ts` exporting a `scrubPayload(event, hint?)` stub that throws "not implemented — Wave 2"; types are `unknown` for now (Plan 05 will tighten to `Event` / `EventHint` from `@sentry/cloudflare` after the install task lands). No `Sentry.init` in this stub. Follow CONVENTIONS.md TS style (named exports, JSDoc-free, no `default export`).
  </action>
  <verify>
    <automated>npm run typecheck</automated>
  </verify>
  <done>All 3 files exist; `npm run typecheck` exits 0 from repo root; `npm run lint` exits 0; runtime call of any stub throws "not implemented — Wave 2".</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create 4 new RED test files + extend 2 existing test files</name>
  <files>mcp/test/cli/mcp-command.test.ts, mcp/test/capture/daemon-backoff.test.ts, backend/test/lib/observability.test.ts, backend/test/lib/observability-wiring.test.ts, mcp/test/cli/init.test.ts, mcp/test/cli/status.test.ts</files>
  <read_first>
    - .planning/phases/01-stabilize-backend-observability/01-VALIDATION.md §"Per-Task Verification Map" (every row)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Code Examples" (lines 635-722)
    - mcp/test/capture/handoff-sync.test.ts (lines 1-50) — tmpdir test pattern
    - mcp/test/unit/browser-auth.test.ts (lines 100-140) — fake timers pattern
    - mcp/test/cli/init.test.ts (full) — existing structure to extend
    - mcp/test/cli/status.test.ts (full) — existing structure to extend
    - .planning/codebase/TESTING.md
  </read_first>
  <behavior>
    For each VALIDATION.md row, write a test that NAMES the expected behavior in its `it()` description and CALLS the (currently-stubbed) function. These tests MUST FAIL on Wave 1 (because the stubs throw "not implemented") and PASS as Wave 2 lands each implementation.

    `mcp-command.test.ts` cases (BUG-03):
      - it("resolves to absolute bin path when `which synapsesync` succeeds") — mocks `child_process.execSync` to return "/usr/local/bin/synapsesync" and `fs.existsSync` true, asserts `command` equals that path and `args` is empty.
      - it("resolves to `node <abs>/dist/index.js` when which fails but dist exists") — mocks `execSync` to throw, `fs.existsSync` true on dist path, asserts `command === process.execPath` and `args[0]` ends with `dist/index.js`.
      - it("returns `npx synapsesync` last-resort when neither resolves") — mocks `execSync` throw + `fs.existsSync` false, asserts `command === "npx"` and `args === ["synapsesync"]`.
      - it("probeNpmRegistry returns false on 2s timeout") — mocks `fetch` to never resolve (returns a never-settling Promise), `vi.useFakeTimers()`, advances by 2001ms, asserts result is `false`.

    `daemon-backoff.test.ts` cases (BUGS.md #12):
      - it("starts at base delay 10s") — driven by mocked `runFlushCycle` returning OK, asserts next setTimeout delay is in [7500, 12500] (±25% jitter range around 10000).
      - it("doubles on each failure: 10→20→40→80→160→300") — mocked flush throws, advance timers, assert delays stay within jittered band for each step.
      - it("caps at MAX_DELAY 300s") — keeps throwing, asserts delay never exceeds 375000ms (300000 × 1.25 jitter upper bound).
      - it("resets to base on first success") — fail twice then succeed, assert next delay is back in the 10s band.
      - it("jitter is within ±25% of the current delay") — assert range explicitly with multiple runs.

    `observability.test.ts` cases (OBS-01 scrubPayload):
      - it("removes event.extra[k].payload from synapse-shaped event objects") — input event with `extra: { ev: { event_id: "x", kind: "tool_used", payload: { secret: "y" } } }`, asserts output has no `.payload` key.
      - it("preserves stack traces and request metadata") — input has `exception`, `request: { url, method }`, asserts those are unchanged.
      - it("returns the same event when no synapse-shaped data is attached") — input has only standard Sentry fields, asserts deep equality with input.
      - it("removes event.request.data and event.breadcrumbs[*].data.payload") — covers the Hono body-capture path.

    `observability-wiring.test.ts` (OBS-01 wiring assertion):
      - it("backend/src/index.ts calls app.use(sentry(...)) BEFORE CORS") — reads `backend/src/index.ts` from disk as text, asserts the first occurrence of `app.use(` after the `const app = new Hono` line includes `sentry(`. Use `grep -v '^//' | grep -v '^ *\*'` style comment stripping to avoid false positives from commented examples (per Critical Rules / grep gate hygiene in planner role). This test is module-level — does not require importing the real app.

    `init.test.ts` extensions (BUG-04) — append, do not rewrite:
      - it("writes a new .mcp.json in cwd with the synapse server entry") — uses existing tmpdir pattern with `SYNAPSE_HOME` override, also `process.chdir(tmp)`, runs `runInit({ api_key: "test" })`, asserts `${tmp}/.mcp.json` exists and contains `mcpServers.synapse`.
      - it("merges into an existing .mcp.json preserving other server entries") — seeds `${tmp}/.mcp.json` with `{ mcpServers: { cursor: { command: "x" } } }`, runs `runInit`, asserts both `cursor` and `synapse` are present.
      - it("backs up and rewrites an invalid existing .mcp.json") — seeds an unparseable file, runs `runInit`, asserts `.mcp.json.bak` exists with original content (per existing `writeMcpJson` corrupt path).
      - it("calls ensureGitignore(cwd, '.mcp.json') whenever cwd .mcp.json is written") — spies on `ensureGitignore` and asserts called with the cwd path and `.mcp.json` arg.

    `status.test.ts` extensions (BUG-02) — append, do not rewrite:
      - it("returns true when launchctl print reports the label loaded") — mocks `execSync` to return a stdout containing `pid = 12345`, asserts `DaemonManager.isRunning()` is true and the status surface tags supervisor as `launchd`.
      - it("returns false when launchctl print throws (service not loaded)") — mocks `execSync` to throw with exit 113, asserts `isRunning()` returns false.
      - it("falls back to PID-file check on non-supervisor platforms") — mocks `process.platform = "win32"`, asserts the PID-file branch runs (existing tier-2 behavior).
      - it("capture status output distinguishes 'supervised by launchd/systemd' from 'alive via PID'") — invokes the status command surface with the launchd-mock, asserts output substring "supervised by launchd".
  </behavior>
  <action>
    Write all 4 new test files at the paths above, mirroring the tmpdir + fake-timer patterns from RESEARCH §"Code Examples". For the 2 existing files (`init.test.ts`, `status.test.ts`), APPEND new `describe(...)` blocks; do not modify existing tests. Each test imports from the Task-1 stub paths (`mcp/src/cli/util/mcp-command`, `mcp/src/cli/util/daemon-supervisor`, `backend/src/lib/observability`). All tests should reference behaviors verbatim from VALIDATION.md "Per-Task Verification Map" rows so the row → test mapping is one-line greppable. DO NOT skip any test (no `.skip` / `it.skip`); they MUST be RED until Wave 2 lands.

    For `observability-wiring.test.ts`, read `backend/src/index.ts` as text via `fs.readFileSync`, strip line-comments (`//...`) and block-comments before grepping for `app.use(sentry(`, to avoid the comment-gate self-invalidation pitfall called out in the planner role's grep-gate hygiene rule.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/mcp-command.test.ts test/cli/status.test.ts test/cli/init.test.ts test/capture/daemon-backoff.test.ts 2>&1 | grep -E "(Tests|FAIL|pass)" | tail -5</automated>
    <automated>cd backend && npx vitest run test/lib/observability.test.ts test/lib/observability-wiring.test.ts 2>&1 | grep -E "(Tests|FAIL|pass)" | tail -5</automated>
  </verify>
  <done>All 6 files exist; `npx vitest run` shows the expected failures (BUG-02: 4 failing, BUG-03: 4 failing, BUG-04: 4 failing, BUGS.md #12: 5 failing, OBS-01: 4 failing scrubPayload + 1 failing wiring = 22 RED tests total per VALIDATION.md map); `npm run lint && npm run typecheck` exit 0 from repo root.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none in this plan) | Wave 0 is test scaffolding + stubs only. No new code paths, no inputs, no network surface. Trust boundaries are introduced by the Wave 2 plans (OBS-01 introduces the Sentry SDK transport; BUG-03 introduces a 2-second fetch to registry.npmjs.org). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-SC | Tampering | npm install (none in this plan) | n/a | This plan installs zero packages. Sentry installs occur in Plan 05; the `@sentry/hono` legitimacy checkpoint lives there per RESEARCH §"Package Legitimacy Audit". |
</threat_model>

<verification>
After both tasks complete:
1. `npm run lint` exits 0 (repo root)
2. `npm run typecheck` exits 0 (repo root) — proves stubs compile and tests type-check against them
3. `cd mcp && npx vitest run` shows ≥17 failing tests in slice-1a test files (4 BUG-02 + 4 BUG-03 + 4 BUG-04 + 5 BUGS.md #12)
4. `cd backend && npx vitest run` shows ≥5 failing tests in `backend/test/lib/observability*.test.ts`
5. Failures all reference the "not implemented — Wave 2" stub throws — confirming the RED step.

Pre-push hook will run on commit; expected outcome: lint pass, typecheck pass, test FAIL (intentional). Push with the hook running once at the wave boundary per CONTEXT.md guidance — commit locally, push to `tanmain/synapse` after Wave 2 lands. (Alternatively: commit + `git push --no-verify` for the wave-0 commit only, then push normally after Wave 2. Operator's call.)
</verification>

<success_criteria>
- All 9 file paths in `files_modified` exist on disk with the contents described.
- VALIDATION.md "Wave 0 Requirements" checklist can be ticked: 4 new test files exist, 2 existing test files extended.
- Wave 2 plans (02, 03, 04, 05) can each touch ONE file without needing to also create supporting test or stub files.
- 22 RED tests are queued, mapped to the VALIDATION.md "Per-Task Verification Map" rows that Wave 2 will turn green.
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-01-SUMMARY.md` when done. Note in the summary which VALIDATION.md rows are queued RED for Wave 2.
</output>
