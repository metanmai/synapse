---
phase: 02-real-user-identity
plan: 3
type: execute
wave: 2
depends_on: ["02-01"]
files_modified:
  - mcp/src/capture/actor.ts
  - mcp/src/capture/handoff-brief.ts
autonomous: true
requirements: [IDENT-02]
threat_refs: []

must_haves:
  truths:
    - "Brief renderer differentiates same-device vs cross-device for the SAME user"
    - "When most-recent activity came from a different device of the same user, the brief surfaces the remote actor's hostname"
    - "When most-recent activity came from the same device, the existing 'Your last activity' line is preserved"
    - "Other-user branch (different user_id) is UNCHANGED — cross-user surfacing is Phase 4 scope"
    - "readOrCreateDeviceId is exported so the brief renderer can compare actor.device_id to the local device_id"
  artifacts:
    - path: "mcp/src/capture/actor.ts"
      provides: "readOrCreateDeviceId is now exported (was unexported)"
      contains: "export function readOrCreateDeviceId"
    - path: "mcp/src/capture/handoff-brief.ts"
      provides: "render() extended with device-origin branch using actor.hostname"
      contains: "readOrCreateDeviceId"
  key_links:
    - from: "mcp/src/capture/handoff-brief.ts:render"
      to: "mcp/src/capture/actor.ts:readOrCreateDeviceId"
      via: "import from ./actor.js"
      pattern: "import.*readOrCreateDeviceId.*actor"
    - from: "mcp/src/capture/handoff-brief.ts:render"
      to: "mostRecent.actor.hostname"
      via: "Actor type from @synapse/shared/handoff/types"
      pattern: "actor\\.hostname"
---

<objective>
Implement Slice D — Device-origin in the brief renderer. Locked decision: D-09 (brief prepends device origin when most-recent activity came from a different device of the same user). Per RESEARCH.md Open Question 2 + recommendation at lines 774-776, Phase 2 uses `actor.hostname` directly (already on the Actor type) instead of joining `api_keys.label`. Schema-based device-name lookup (Pattern 6 approach 1) is deferred to Phase 2.5 if dogfood reveals hostname is too noisy.

Purpose: deliver part of IDENT-02 SC #2 — "produces a brief that includes machine-A activity" — by making the brief explicitly attribute remote-device activity. Without this, a brief on machine B would say "Most recent activity (<user_id>, ...)" which is technically correct but confusing because the user IS that user; the cross-device branch is the missing piece.

Output: 2 EXTENDED files. `mcp/src/capture/actor.ts` exports `readOrCreateDeviceId` (was unexported). `mcp/src/capture/handoff-brief.ts` adds a same-user-different-device branch inside the existing `mostRecent.actor.user_id === viewer` block.
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
@mcp/src/capture/actor.ts
@mcp/src/capture/handoff-brief.ts
@packages/shared/src/handoff/types.ts

<interfaces>
<!-- The Actor type and current render() shape that this plan extends. -->

From packages/shared/src/handoff/types.ts (the Actor type — hostname is already on it):
```typescript
interface Actor {
  user_id: string;
  device_id: string;
  hostname: string;
  kind: "human" | "claude" | "synapse-mcp" | "tool";
  // ...
}
```

From mcp/src/capture/actor.ts:8-15 (the device-id source — currently NOT exported):
```typescript
function readOrCreateDeviceId(): string {
  const idFile = path.join(synapseRoot(), "device_id");
  if (fs.existsSync(idFile)) return fs.readFileSync(idFile, "utf-8").trim();
  fs.mkdirSync(synapseRoot(), { recursive: true });
  const id = randomBytes(8).toString("hex");
  fs.writeFileSync(idFile, id);
  return id;
}
```

From mcp/src/capture/handoff-brief.ts:17-43 (current render — the most-recent branch is what this plan extends):
```typescript
function render(s: ProjectStatus, viewer: string): string {
  // ... project_id + current_next_step ...
  const mostRecent = s.active_actors[0];
  if (mostRecent) {
    const focus = mostRecent.current_focus ?? "(no focus)";
    const branch = mostRecent.branch ?? "(no branch)";
    if (mostRecent.actor.user_id === viewer) {
      lines.push(`Your last activity: ${focus} on ${branch}`);
    } else {
      lines.push(
        `Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state}): ${focus} on ${branch}`,
      );
    }
  }
  // ...
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Export readOrCreateDeviceId from actor.ts</name>
  <files>mcp/src/capture/actor.ts</files>
  <read_first>
    - mcp/src/capture/actor.ts (full file — confirm line 8-15 readOrCreateDeviceId is currently unexported; confirm resolveActor uses it; verify no other functions need to be exported)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 987-990 — exact extension)
  </read_first>
  <behavior>
    - readOrCreateDeviceId is exported (named export)
    - All existing call sites within actor.ts (resolveActor) continue to work
    - No new dependents are broken — the only NEW consumer is mcp/src/capture/handoff-brief.ts in the next task
  </behavior>
  <action>
    Single one-word change: add the `export` keyword in front of `function readOrCreateDeviceId(): string` at line 8 of `mcp/src/capture/actor.ts`. No other modifications to the file. The body is preserved verbatim (per PATTERNS.md line 987-990: "/* unchanged body */"). Verify by reading the file after the edit that the function signature is `export function readOrCreateDeviceId(): string` and that the body still does the synapseRoot()/device_id read-or-create.
  </action>
  <verify>
    <automated>grep -c "^export function readOrCreateDeviceId" mcp/src/capture/actor.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^export function readOrCreateDeviceId" mcp/src/capture/actor.ts` returns 1
    - The function body is unchanged: `grep -c "randomBytes(8).toString" mcp/src/capture/actor.ts` ≥ 1 (the .toString("hex") line)
    - `cd mcp && npm run typecheck` passes (no TS errors — resolveActor still calls readOrCreateDeviceId correctly)
    - `cd mcp && npm test` — existing actor.ts test suite (if any) PASSES; full mcp test suite has no new failures
  </acceptance_criteria>
  <done>readOrCreateDeviceId is exported, the body unchanged, mcp suite still green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend handoff-brief render() with same-user-cross-device branch</name>
  <files>mcp/src/capture/handoff-brief.ts</files>
  <read_first>
    - mcp/src/capture/handoff-brief.ts (full file — confirm current render() at lines 17-43; understand the lines.push order, the project_id/current_next_step preamble, and how the function returns the joined string)
    - mcp/src/capture/actor.ts (after Task 1 — confirm readOrCreateDeviceId is exported)
    - packages/shared/src/handoff/types.ts (Actor type — confirm hostname field exists and is string)
    - mcp/test/capture/handoff-brief.test.ts (Plan-01 RED cases — confirm the 3 behaviors this task must satisfy: same-device, cross-device-same-user, other-user-unchanged)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 992-1051 — exact extension shape; line 1051 — the test contract: "when actor.device_id ≠ local device_id, the brief contains the remote actor's hostname")
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 376-401 + 1015-1049 — Pattern 6 + actor.hostname recommendation; line 1051 — test generality contract per feedback_test_generality.md)
  </read_first>
  <behavior>
    - When mostRecent.actor.user_id === viewer AND mostRecent.actor.device_id === readOrCreateDeviceId() → brief contains "Your last activity: <focus> on <branch>" (unchanged from today)
    - When mostRecent.actor.user_id === viewer AND mostRecent.actor.device_id !== readOrCreateDeviceId() → brief contains a line that includes mostRecent.actor.hostname (e.g., "Most recent activity (on <hostname>): <focus> on <branch>")
    - When mostRecent.actor.hostname is empty/undefined for cross-device case → brief uses fallback "another device" rather than literally embedding "undefined"
    - When mostRecent.actor.user_id !== viewer → existing other-user line unchanged: "Most recent activity (<user_id>, <activity_state>): <focus> on <branch>"
    - All other behavior of render() is preserved (project_id line, current_next_step line, rest of body)
  </behavior>
  <action>
    Add `import { readOrCreateDeviceId } from "./actor.js";` at the top of `mcp/src/capture/handoff-brief.ts` (alongside existing imports). Modify the same-user branch inside the `mostRecent` block to split into same-device vs cross-device sub-branches per PATTERNS.md lines 1020-1049. The cross-device sub-branch uses `mostRecent.actor.hostname || "another device"` as the fallback. The other-user branch is preserved verbatim (`Most recent activity (${user_id}, ${activity_state}): ...`) — that path is Phase 4 scope and Phase 2 must NOT change it (per RESEARCH.md line 1041-1044 + CONTEXT.md Phase 4 deferred ideas line 152-156). Do NOT call readOrCreateDeviceId at module-load time — call it inside render() so each invocation reads fresh (matches the no-cache anti-pattern at RESEARCH.md line 418). Per `feedback_test_generality.md` and PATTERNS.md line 1051, the test contract is "brief contains the remote actor's hostname" — Plan-01's tests assert this behaviorally, not a literal string.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/capture/handoff-brief.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "readOrCreateDeviceId" mcp/src/capture/handoff-brief.ts` ≥ 2 (one import, at least one call inside render)
    - `grep -c "actor.hostname" mcp/src/capture/handoff-brief.ts` ≥ 1
    - Plan-01's three RED cases in `mcp/test/capture/handoff-brief.test.ts` flip GREEN:
      - "same user, same device → 'Your last activity'" PASSES
      - "same user, different device → brief contains actor.hostname" PASSES
      - "different user → existing other-user line unchanged" PASSES (regression guard)
    - `cd mcp && npm run lint && npm run typecheck && npm test` — all pass
    - The other-user branch literal `Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state})` is PRESERVED — verify by `grep -c "activity_state" mcp/src/capture/handoff-brief.ts` ≥ 1
  </acceptance_criteria>
  <done>handoff-brief.ts contains the same-user-cross-device branch using actor.hostname; same-user-same-device branch unchanged; other-user branch unchanged; Plan-01 brief tests flip GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Brief renderer (local) → user display | The brief is read by the user in their Claude Code session; no network crossing |
| Reducer (server) → brief data | The brief renderer reads ProjectStatus.active_actors which is server-computed; trust boundary is at the auth layer that produces ProjectStatus |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-INFO | Information Disclosure | Hostname leaks across user boundaries via brief | accept | The viewer === viewer check at the top of the same-user branch ensures the cross-device sub-branch only fires for THE viewer's own devices. A different user's hostname goes through the OTHER branch (unchanged: "Most recent activity (user_id, state):") which already exposes user_id. Phase 4 will address cross-user surfacing more thoughtfully. |
| T-02-SPOOF | Spoofing | Attacker forges actor.device_id to inject "your other laptop" copy | accept | Forging a device_id is local — requires writing to ~/.synapse/device_id, which is per-user. Backend events-batch.ts:60 overrides actor_user_id but does NOT override device_id. However, device_id only affects display copy, not access control. Worst case: a confusing brief, not a security breach. Phase 4 cross-user collaboration will enforce stronger device-attribution if needed. |
</threat_model>

<verification>
- `cd mcp && npx vitest run test/capture/handoff-brief.test.ts` — all 3 Plan-01 RED cases flip GREEN
- `cd mcp && npm run lint && npm run typecheck && npm test` — full mcp suite passes
- Manual gate (deferred to verify-work): on a real two-machine setup, observe machine B's brief after machine A has emitted events — the brief should contain machine A's hostname for the most-recent-activity line
</verification>

<success_criteria>
- IDENT-02 partial: the brief surfaces device origin when most-recent activity is from a different device of the same user
- mcp/src/capture/actor.ts:readOrCreateDeviceId is exported (named export)
- mcp/src/capture/handoff-brief.ts uses actor.hostname for cross-device branch (Phase 2 scope; Pattern 6 approach 1 deferred to Phase 2.5)
- Existing same-device "Your last activity" line preserved
- Existing other-user branch preserved verbatim (Phase 4 scope is untouched)
- All Plan-01 RED brief tests flip GREEN
</success_criteria>

<output>
Create `.planning/phases/02-real-user-identity/02-03-SUMMARY.md` when done. Summary must:
- Confirm actor.ts exports readOrCreateDeviceId
- Confirm handoff-brief.ts uses actor.hostname (not a server-side join — Pattern 6 approach 1 deferred per Open Question 2 in RESEARCH.md)
- Note that other-user branch is unchanged (Phase 4 scope)
- List which Plan-01 RED brief cases flipped GREEN
- Flag follow-up: if dogfood shows hostname is too verbose, file a Phase 2.5 task to add `api_keys.device_id` schema column + cleaner `cli-<device-name>` lookup
</output>
