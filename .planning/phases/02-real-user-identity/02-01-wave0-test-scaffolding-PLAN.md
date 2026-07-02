---
phase: 02-real-user-identity
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/test/api/auth-me.test.ts
  - backend/test/api/projects-merge.test.ts
  - backend/test/api/events-batch-auto-create.test.ts
  - mcp/test/cli/init.test.ts
  - mcp/test/cli/hook-dispatch.test.ts
  - mcp/test/capture/handoff-sync.test.ts
  - mcp/test/capture/handoff-brief.test.ts
  - mcp/test/e2e/handoff.e2e.test.ts
autonomous: true
requirements: [IDENT-01, IDENT-02]
threat_refs: [T-02-01, T-02-02, T-02-04]

must_haves:
  truths:
    - "All Wave 0 test files exist (8 files: 2 NEW, 6 EXTEND)"
    - "Test files compile under vitest (no TS errors)"
    - "Tests are RED — assertions on behavior not yet implemented"
    - "Sampling continuity preserved — no 3 consecutive Wave 2+ tasks lack a corresponding test"
  artifacts:
    - path: "backend/test/api/auth-me.test.ts"
      provides: "Contract for GET /api/account/me — 401 + 200 paths"
      contains: "describe(\"GET /api/account/me"
    - path: "backend/test/api/projects-merge.test.ts"
      provides: "Contract for POST /api/projects/:id/merge-into/:target_id — auth + route registration"
      contains: "describe(\"POST /api/projects/:id/merge-into/:target_id"
    - path: "mcp/test/cli/init.test.ts"
      provides: "Extended init test cases — fetchMe ordering, user_id persistence, idempotence"
      contains: "fetchMe"
    - path: "mcp/test/cli/hook-dispatch.test.ts"
      provides: "Extended hook-dispatch test cases — env precedence, config fallback, placeholder fallback"
      contains: "readUserIdFromConfig"
    - path: "mcp/test/capture/handoff-sync.test.ts"
      provides: "Extended sync test cases — runEagerPullCycle, _pulled marker, watermark"
      contains: "runEagerPullCycle"
    - path: "mcp/test/capture/handoff-brief.test.ts"
      provides: "Extended brief test cases — same-device, cross-device-same-user, other-user"
      contains: "device_id"
    - path: "mcp/test/e2e/handoff.e2e.test.ts"
      provides: "Extended e2e — machine-A → machine-B fresh tmpdir scenario"
      contains: "machine"
    - path: "backend/test/api/events-batch-auto-create.test.ts"
      provides: "Extended events-batch auto-create test cases — git_remote_url schema acceptance"
      contains: "git_remote_url"
  key_links:
    - from: "backend/test/api/auth-me.test.ts"
      to: "worker.fetch + createExecutionContext"
      via: "vitest + @cloudflare/vitest-pool-workers"
      pattern: "import worker from"
    - from: "mcp/test/cli/init.test.ts"
      to: "vi.spyOn(globalThis, \"fetch\")"
      via: "vitest mock of fetch"
      pattern: "spyOn.*fetch"
---

<objective>
Create the Wave 0 test scaffolding for Phase 2 — Real User Identity. These tests describe the contract for IDENT-01 (real user UUID in events) and IDENT-02 (cross-device sync). All tests are written RED (intentionally failing) because their implementations land in Wave 2+. This satisfies the Nyquist sampling rule: every code-producing task in Wave 2+ has a corresponding test added in Wave 1 with no 3 consecutive Wave 2+ tasks lacking automated verify.

Purpose: lock the behavior contract before implementation. Tests guard the bug class per `feedback_test_generality.md`, not specific string outputs.

Output: 2 NEW test files + 6 EXTENDED test files; all reference contracts from `02-RESEARCH.md` § Phase Requirements → Test Map (lines 851-921) and `02-VALIDATION.md` § Wave 0 Requirements (lines 51-62).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-real-user-identity/02-CONTEXT.md
@.planning/phases/02-real-user-identity/02-RESEARCH.md
@.planning/phases/02-real-user-identity/02-PATTERNS.md
@.planning/phases/02-real-user-identity/02-VALIDATION.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/TESTING.md
@backend/test/api/projects.test.ts
@backend/test/api/events-batch-auto-create.test.ts
@mcp/test/cli/init.test.ts
@mcp/test/cli/hook-dispatch.test.ts
@mcp/test/capture/handoff-sync.test.ts
@mcp/test/capture/handoff-brief.test.ts
@mcp/test/e2e/handoff.e2e.test.ts

<interfaces>
<!-- Test scaffolding pattern from existing test files. Executor reuses these shapes. -->

From backend/test/api/projects.test.ts (line 1-25):
```typescript
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("...", () => {
  it("...", async () => {
    const req = new Request("http://localhost/api/...");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(...);
  });
});
```

From backend/test/api/events-batch-auto-create.test.ts (line 64-67): pattern for live-DB tests:
```typescript
it.skip("requires live DB — ...", async () => {
  // Live verification: ...
});
```

From mcp/test/cli/init.test.ts: tmpdir SYNAPSE_HOME setup with process.chdir + vi.restoreAllMocks().

Mock fetch pattern:
```typescript
vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
  new Response(JSON.stringify({ user_id: "u1", email: "e@x" }), { status: 200 })
);
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create new backend test files — auth-me.test.ts + projects-merge.test.ts</name>
  <files>backend/test/api/auth-me.test.ts, backend/test/api/projects-merge.test.ts</files>
  <read_first>
    - backend/test/api/projects.test.ts (analog structural test pattern — auth-rejection 401 + route-not-404)
    - backend/test/api/events-batch-auto-create.test.ts (analog for .skip live-DB cases)
    - backend/test/setup.ts (testing helpers — createExecutionContext, env, waitOnExecutionContext)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 1387-1494 — full scaffolds for both files)
  </read_first>
  <behavior>
    auth-me.test.ts (~80 LOC):
    - GET /api/account/me without Authorization header returns 401
    - GET /api/account/me with invalid Bearer token returns 401
    - Route is registered (no 404) when Authorization present even if invalid
    - it.skip: 200 with {user_id, email, tier} for valid api_key, user_id matches public.users.id (not auth.users.id) — requires live DB

    projects-merge.test.ts (~60 LOC):
    - POST /api/projects/:id/merge-into/:target_id without auth returns 401
    - Route is registered for source/target IDs (no 404) when Authorization present
    - it.skip: requires owner role on BOTH source and target (returns 403 if not owner of one) — requires live DB
    - it.skip: writes activity_log entry on successful merge — requires live DB
  </behavior>
  <action>
    Create `backend/test/api/auth-me.test.ts` and `backend/test/api/projects-merge.test.ts` using the structural-test pattern from `backend/test/api/projects.test.ts:1-25`. Both files use `worker.fetch` + `createExecutionContext` + `waitOnExecutionContext` from `../setup`. Each file has 3 structural tests (401 unauth, 401 bad auth, route-registered) plus 1-2 `it.skip` cases describing live-DB behavior. Tests assert behavior contracts (status codes, route registration), not literal response strings — per `feedback_test_generality.md`. Both files are intentionally RED until /me route (D-02, Plan 02) and merge route (D-07, Plan 05) land.
  </action>
  <verify>
    <automated>cd backend && npx vitest run test/api/auth-me.test.ts test/api/projects-merge.test.ts 2>&1 | grep -E "(FAIL|PASS|Tests:|✓|✗)" | head -20</automated>
  </verify>
  <acceptance_criteria>
    - File `backend/test/api/auth-me.test.ts` exists and starts with `import { describe, expect, it } from "vitest";`
    - File `backend/test/api/projects-merge.test.ts` exists and starts with `import { describe, expect, it } from "vitest";`
    - `cd backend && npx vitest run test/api/auth-me.test.ts` outputs at least 3 tests in the describe block
    - `cd backend && npx vitest run test/api/projects-merge.test.ts` outputs at least 2 structural tests + skip(s)
    - Both files compile (no TypeScript errors) — verify with `cd backend && npx tsc --noEmit` if needed
    - 401-on-unauth tests PASS (route exists via authMiddleware fall-through OR returns 404, either is acceptable for now — the auth.ts /me route lands Plan 02; the merge route lands Plan 05)
    - Route-registered tests FAIL (RED) — they expect not-404 but routes don't exist yet
  </acceptance_criteria>
  <done>Both files exist, both run under vitest without TypeScript errors, at least one assertion per file is intentionally RED (asserts behavior that lands in Plan 02 or Plan 05).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend mcp test files — init, hook-dispatch, handoff-sync, handoff-brief, events-batch-auto-create</name>
  <files>mcp/test/cli/init.test.ts, mcp/test/cli/hook-dispatch.test.ts, mcp/test/capture/handoff-sync.test.ts, mcp/test/capture/handoff-brief.test.ts, backend/test/api/events-batch-auto-create.test.ts</files>
  <read_first>
    - mcp/test/cli/init.test.ts (current setup at lines 1-28 — tmpdir + SYNAPSE_HOME + process.chdir; existing test patterns)
    - mcp/test/cli/hook-dispatch.test.ts (current setup at lines 6-16 — tmpdir + SYNAPSE_HOME)
    - mcp/test/capture/handoff-sync.test.ts (existing runFlushCycle / runPullCycle tests at lines 18-47)
    - mcp/test/capture/handoff-brief.test.ts (existing setupStatus + makeStatusFromActor helpers at lines 42-72)
    - backend/test/api/events-batch-auto-create.test.ts (existing structural test pattern at lines 10-67)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 1498-1536 — exact test extension specs per file)
    - .planning/phases/02-real-user-identity/02-VALIDATION.md (lines 55-60 — Wave 0 case enumeration)
  </read_first>
  <behavior>
    mcp/test/cli/init.test.ts (~6 new cases):
    - runInit calls fetchMe() BEFORE any disk write — mock fetch to reject, assert ~/.synapse/config.json does NOT exist after rejection
    - runInit writes user_id + email to config on /me success — mock fetch to return {user_id, email}, assert config.json contains both
    - runInit is idempotent on re-run with same key (config.json contents stable)

    mcp/test/cli/hook-dispatch.test.ts (~4 new cases):
    - When process.env.SYNAPSE_USER_ID is set, hook payload carries env value (env wins)
    - When SYNAPSE_USER_ID is unset AND ~/.synapse/config.json has user_id, payload carries config value
    - When neither, payload carries placeholder ("local-user" or whatever readUserIdFromConfig returns)
    - hashCwd determinism preserved (regression guard — existing test pattern at lines 97-103)

    mcp/test/capture/handoff-sync.test.ts (~5 new cases for runEagerPullCycle):
    - Mock fetch returns {events: [ev1, ev2], next_since: ev2.event_id} → events.jsonl appended with _pulled: true markers AND watermark = ev2.event_id
    - Empty pull ({events: []}) → no-op (return {pulled: 0}, no file mutation)
    - 5xx response → throws cleanly
    - Subsequent runFlushCycle filters _pulled events out of POST body
    - Subsequent flush still includes locally-captured (non-_pulled) events

    mcp/test/capture/handoff-brief.test.ts (~3 new cases for D-09):
    - mostRecent.actor.user_id === viewer AND device_id === localDeviceId → brief contains "Your last activity"
    - mostRecent.actor.user_id === viewer AND device_id !== localDeviceId → brief contains mostRecent.actor.hostname (cross-device, same-user)
    - mostRecent.actor.user_id !== viewer → existing other-user line unchanged (regression)

    backend/test/api/events-batch-auto-create.test.ts (~3 new structural cases):
    - Request body schema accepts payload.git_remote_url (no 400 on the new field)
    - cwd_<hash> with git_remote_url populated routes successfully (no 404)
    - Defensive: existing git_basename-only path still resolves (regression guard)
  </behavior>
  <action>
    Extend each of the 5 test files in place. Add new describe blocks (or it() cases inside existing describes) per the per-file behavior list above. Use the existing setup helpers in each file. Mock `globalThis.fetch` via `vi.spyOn` per the pattern in PATTERNS.md line 1506. For handoff-sync tests, mock fetch to return staged event payloads — use existing helpers like `makeEv` if present, otherwise create minimal fixtures inline. For handoff-brief tests, use the existing `makeStatusFromActor` helper (handoff-brief.test.ts:42-72) to construct ProjectStatus with the device_id and hostname assertions described. Per `feedback_test_generality.md`: assert the BEHAVIOR (e.g., "brief contains the actor's hostname when device_id differs"), NOT the literal string format. All new tests are intentionally RED until production code lands in Wave 2+ plans.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/init.test.ts test/cli/hook-dispatch.test.ts test/capture/handoff-sync.test.ts test/capture/handoff-brief.test.ts 2>&1 | grep -E "(FAIL|PASS|Tests:|✓|✗)" | head -30 && cd ../backend && npx vitest run test/api/events-batch-auto-create.test.ts 2>&1 | grep -E "(FAIL|PASS|Tests:|✓|✗)" | head -10</automated>
  </verify>
  <acceptance_criteria>
    - `mcp/test/cli/init.test.ts` has at least 3 new test cases referencing `fetchMe` (grep finds `fetchMe` in file outside comments)
    - `mcp/test/cli/hook-dispatch.test.ts` has at least 3 new test cases referencing `SYNAPSE_USER_ID` env-var precedence (grep finds `SYNAPSE_USER_ID` in test body, not just imports)
    - `mcp/test/capture/handoff-sync.test.ts` has at least 4 new test cases referencing `runEagerPullCycle` or `_pulled` (grep finds either)
    - `mcp/test/capture/handoff-brief.test.ts` has at least 3 new test cases referencing `device_id` (grep finds in test bodies)
    - `backend/test/api/events-batch-auto-create.test.ts` has at least 2 new test cases referencing `git_remote_url`
    - All 5 files compile under TypeScript (`cd mcp && npx tsc --noEmit` and `cd backend && npx tsc --noEmit` pass — for backend, /me, fetchMe and runEagerPullCycle import sites do not exist yet, so use `// @ts-expect-error` or import-from-future-path comments only where strictly needed; prefer keeping tests in vi.mock or skip-via-runtime-flag form so tsc stays green)
    - At least one new case in EACH file FAILS under vitest (RED — asserts contract not yet implemented)
    - hashCwd determinism regression guard (existing test) still PASSES
  </acceptance_criteria>
  <done>All 5 extended test files contain the case counts listed in the behavior block above; full mcp + backend test suites compile; intentionally-RED cases exist and are visible in vitest output.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend mcp/test/e2e/handoff.e2e.test.ts with multi-device scenario</name>
  <files>mcp/test/e2e/handoff.e2e.test.ts</files>
  <read_first>
    - mcp/test/e2e/handoff.e2e.test.ts (existing describe block lines 28-82 — "machine A focus + flush" pattern; full file for stub setup)
    - mcp/test/e2e/stub-backend.ts (in-process stub backend — extend to serve GET /api/projects/:id/events for the eager-pull arm of the new scenario)
    - mcp/src/capture/actor.ts (lines 8-15 — readOrCreateDeviceId mechanism, file-based at synapseRoot()/device_id)
    - mcp/src/cli/handlers.ts (lines 90-103 — readUserIdFromConfig pattern; the e2e test will write a config.json with user_id)
    - .planning/phases/02-real-user-identity/02-VALIDATION.md (line 61 — multi-device scenario contract)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 869, 915-916 — e2e test description)
  </read_first>
  <behavior>
    New describe block: "machine A → machine B same user same repo same git_remote_url"
    - Setup: two tmpdir-rooted SYNAPSE_HOME directories (tmpA and tmpB), each with a config.json containing the SAME user_id; tmpA's device_id file is "device-a-hex", tmpB's is "device-b-hex"
    - In tmpA: run hook (or its core appendEvent function) to capture a SessionStart with focus="working on auth", branch="main", hostname="laptop-A"; flush via runFlushCycle pointed at the stub backend; assert stub received the event
    - Stub returns canonical_project_ids remapping cwd_<hashA> → "canonical-uuid"
    - In tmpB: simulate "machine B" by setting SYNAPSE_HOME=tmpB, writing a config.json with the SAME user_id, and the stub serves GET /api/projects/canonical-uuid/events with the event captured on machine A
    - In tmpB: call runEagerPullCycle (or equivalent eager-pull path) → assert events.jsonl in tmpB contains the machine-A event with _pulled: true marker
    - In tmpB: render the brief via the brief renderer — assert the rendered text contains the actor's hostname from machine A ("laptop-A") AND the focus string ("working on auth")
    - Per feedback_test_generality.md: assert the BEHAVIOR (brief mentions the remote hostname and focus), not a literal full-string match
  </behavior>
  <action>
    Append one new describe block to `mcp/test/e2e/handoff.e2e.test.ts` named "machine A → machine B cross-device sync". Reuse the existing tmpdir scaffolding pattern. Use stub-backend.ts to serve both POST /api/events/batch (existing) AND GET /api/projects/:id/events (extend stub if not already present — the stub is in-process so the extension is local). The test is intentionally RED until runEagerPullCycle (Plan 04) and writeBrief device-origin (Plan 03) land. The test does NOT require the real `getGitRemoteUrl` shell-out — pass git_remote_url explicitly in the event payload to simulate the daemon's hook-time capture. Set TEST_E2E=1 env (this test only runs in the e2e harness, not the regular suite).
  </action>
  <verify>
    <automated>cd mcp && TEST_E2E=1 npx vitest run test/e2e/handoff.e2e.test.ts 2>&1 | grep -E "(FAIL|PASS|Tests:|✓|✗|describe|machine)" | head -30</automated>
  </verify>
  <acceptance_criteria>
    - File `mcp/test/e2e/handoff.e2e.test.ts` contains the literal substring "machine A → machine B" or "machine-A → machine-B" or "cross-device" in a describe() block name (grep `-v '^#\|^ *//' | grep -ci "machine.*machine\|cross-device"` ≥ 1)
    - File contains a call to runEagerPullCycle OR fetches GET `/api/projects/:id/events` via stub
    - File compiles under TypeScript: `cd mcp && npx tsc --noEmit` passes (use ts-expect-error on imports for symbols not yet exported by handoff-sync.ts in Plan 04)
    - When run via `cd mcp && TEST_E2E=1 npx vitest run test/e2e/handoff.e2e.test.ts`, the new describe block reports at least one FAILING test (intentional RED)
    - Existing describe blocks in handoff.e2e.test.ts still pass (regression guard)
  </acceptance_criteria>
  <done>handoff.e2e.test.ts contains the new describe block; the block runs (not skipped) and FAILS for the right reason (assertion on behavior not yet implemented in Plans 03/04); existing tests still pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test runner → vitest mock fetch | Mocks fetch in process — no real network from these tests |
| Test runner → tmpdir SYNAPSE_HOME | Tests own their tmpdir; cleanup via afterEach |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Elevation of Privilege | Test scaffolds for /merge-into endpoint | mitigate | Wave 0 includes a structural test asserting 401-on-unauth + route-registered behavior. Live-DB owner-check test is `.skip` (deferred to verify-work manual gate per VALIDATION.md). Catches "merge endpoint mounted without authMiddleware" regression. |
| T-02-02 | Tampering | Tests for events-batch git_remote_url payload field | mitigate | Wave 0 adds events-batch-auto-create tests that assert the schema accepts the new field — guards against accidentally locking it out via a strict zod schema regression. |
| T-02-04 | Denial of Service | Rate-limit bypass on new /me or /merge-into | accept | Existing `app.use("*", rateLimit(...))` at backend/src/index.ts:46 covers all new routes automatically — Wave 0 tests don't need to re-verify the global rate limiter; verified at deploy time. |
</threat_model>

<verification>
- `cd backend && npx vitest run test/api/auth-me.test.ts test/api/projects-merge.test.ts test/api/events-batch-auto-create.test.ts` shows test files load and execute (some RED, some PASS)
- `cd mcp && npx vitest run test/cli/init.test.ts test/cli/hook-dispatch.test.ts test/capture/handoff-sync.test.ts test/capture/handoff-brief.test.ts` shows test files load and execute
- `cd mcp && TEST_E2E=1 npx vitest run test/e2e/handoff.e2e.test.ts` shows the new multi-device describe block runs and FAILs intentionally
- `cd backend && npx tsc --noEmit && cd ../mcp && npx tsc --noEmit` — both workspaces typecheck (use ts-expect-error sparingly only on imports of symbols not yet implemented)
- Existing tests in all 5 EXTENDED files still pass (no regression in hashCwd determinism etc.)
</verification>

<success_criteria>
- 2 NEW test files exist (`auth-me.test.ts`, `projects-merge.test.ts`)
- 6 EXTENDED test files contain the new case counts per the per-file behavior block
- All 8 files compile (no TypeScript errors)
- At least one assertion in each file is intentionally RED (asserts contract that lands in Wave 2+)
- 02-VALIDATION.md's Wave 0 checklist (lines 55-62) is satisfiable — all 8 boxes can be checked after this plan ships
</success_criteria>

<output>
Create `.planning/phases/02-real-user-identity/02-01-SUMMARY.md` when done. Summary must:
- List each of the 8 test files touched (2 NEW, 6 EXTENDED), with the count of new it() cases per file
- Note which cases pass (PASS) vs which are intentionally red (RED) — this informs Wave 2+ executors which contracts they must satisfy
- Confirm `cd backend && npx tsc --noEmit && cd ../mcp && npx tsc --noEmit` passes
- Update `02-VALIDATION.md`'s Wave 0 Requirements checklist (lines 55-62) — flip each `- [ ]` to `- [x]` for the files this plan completes
</output>
