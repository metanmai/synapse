---
phase: 03-free-plus-tier-redesign
plan: 1
type: execute
wave: 0
depends_on: []
files_modified:
  - backend/src/lib/constants.ts
  - backend/src/lib/tier.ts
  - backend/test/lib/tier-enforce.test.ts
autonomous: true
requirements: [TIER-01]

# Historical note: the auto-sync tier policy in this executed plan was
# superseded by all-tier daemon continuity in 3776c154. See 03-01-SUMMARY.md.

must_haves:
  truths:
    - "New per-tier capacity constants exist in backend/src/lib/constants.ts: FREE/PLUS_INSIGHTS_PER_PROJECT, FREE/PLUS_CONVERSATIONS_PER_PROJECT, AUTO_SYNC_TIERS"
    - "Accessors exist in backend/src/lib/tier.ts: getInsightCapForTier, getConversationCapForTier, getDeviceCapForTier, isAutoSyncEnabledForTier"
    - "All accessors follow the dual-surface pattern (tier-string canonical + Context-flavored delegate)"
    - "PURE ADDITIVE: NO existing constant values are changed in this slice. FREE_MAX_PROJECTS stays at 5, DEVICE_LIMIT_PLUS stays at Infinity. Those changes happen in slices 03-02 (FREE_MAX_PROJECTS 5→50) and 03-05 (DEVICE_LIMIT_PLUS ∞→10) where the corresponding enforcement behavior is being shipped."
    - "No existing tests need modification (no behavior change)"
    - "All unit tests pass: npm run test --workspace=backend"
  artifacts:
    - path: "backend/src/lib/constants.ts"
      provides: "Tier limit constants for insights, conversations, devices, auto-sync"
      contains: "FREE_INSIGHTS_PER_PROJECT"
    - path: "backend/src/lib/tier.ts"
      provides: "Per-tier limit accessors (dual-surface pattern)"
      contains: "getInsightCapForTier"
    - path: "backend/test/lib/tier-enforce.test.ts"
      provides: "Unit tests asserting all new accessors return correct values"
      contains: "getInsightCapForTier"
  key_links:
    - from: "backend/src/lib/tier.ts"
      to: "backend/src/lib/constants.ts"
      via: "import { FREE_INSIGHTS_PER_PROJECT, PLUS_INSIGHTS_PER_PROJECT } from './constants'"
      pattern: "import.*constants"
---

<objective>
Centralize all per-tier policy constants in one location so the four follow-on slices (03-02 through 03-05) share a single source of truth. NO behavior change in this slice — only constants + accessors. This is Wave 0 because every follow-on slice imports from here.

Output: 5 new constants, 4 new accessor functions (dual-surface pattern), unit tests asserting the accessor values, and two existing constants updated (FREE_MAX_PROJECTS, DEVICE_LIMIT_PLUS).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md
@.planning/phases/03-free-plus-tier-redesign/03-PATTERNS.md
@.planning/codebase/CONVENTIONS.md
@backend/src/lib/constants.ts
@backend/src/lib/tier.ts
@backend/test/lib/tier-enforce.test.ts

<interfaces>
Dual-surface pattern from tier.ts (lines 61-83): EVERY tier helper has a tier-string flavor (canonical) and a Context flavor (thin wrapper). New helpers MUST follow this — daemon code paths have no Hono Context.

```typescript
// Canonical (tier-string)
export function enforceMemberLimitForTier(currentMemberCount: number, tier: Tier, env?: Record<string, string>, plusPrice = DEFAULT_TIER_PLUS_PRICE) { ... }

// Wrapper (Context)
export function enforceMemberLimit(currentMemberCount: number, c: Context<{ Bindings: Env }>) {
  const tier = (c.get("tier") ?? "free") as Tier;
  enforceMemberLimitForTier(currentMemberCount, tier, ...);
}
```
</interfaces>
</context>

<tasks>

<task id="03-01-1" type="execute">
<title>Add per-tier limit constants to backend/src/lib/constants.ts</title>
<read_first>
  - backend/src/lib/constants.ts (current state — additive edit, don't reorganize existing groups)
  - .planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md (locked numerical values)
</read_first>
<action>
Edit `backend/src/lib/constants.ts` — PURE ADDITIVE. Do not change any existing constant values; only add new ones.

Add new block above `// --- Rate limiting ---`:
```typescript
// --- Per-project capacity limits (per tier) ---
export const FREE_INSIGHTS_PER_PROJECT = 10;
export const PLUS_INSIGHTS_PER_PROJECT = 50;
export const FREE_CONVERSATIONS_PER_PROJECT = 10;
export const PLUS_CONVERSATIONS_PER_PROJECT = 50;

// --- Auto-sync gate (tier → daemon cycle behavior) ---
// Free users sync manually via `synapsesync sync`; Plus runs the 5-min daemon cycle.
export const AUTO_SYNC_TIERS = ["plus"] as const;
```

Do not change FREE_MAX_PROJECTS, PLUS_MAX_PROJECTS, DEVICE_LIMIT_FREE, or DEVICE_LIMIT_PLUS in this slice. Those changes happen in 03-02 and 03-05 where the corresponding enforcement is being changed (keeps the constant change adjacent to the test updates it requires).
</action>
<acceptance_criteria>
  - `grep -c "FREE_INSIGHTS_PER_PROJECT = 10" backend/src/lib/constants.ts` returns 1
  - `grep -c "PLUS_INSIGHTS_PER_PROJECT = 50" backend/src/lib/constants.ts` returns 1
  - `grep -c "FREE_CONVERSATIONS_PER_PROJECT = 10" backend/src/lib/constants.ts` returns 1
  - `grep -c "PLUS_CONVERSATIONS_PER_PROJECT = 50" backend/src/lib/constants.ts` returns 1
  - `grep -c "AUTO_SYNC_TIERS" backend/src/lib/constants.ts` returns 1
  - `grep "FREE_MAX_PROJECTS = " backend/src/lib/constants.ts` outputs `export const FREE_MAX_PROJECTS = 5;` (UNCHANGED — slice 03-02 will change this)
  - `grep "DEVICE_LIMIT_PLUS = " backend/src/lib/constants.ts` outputs `export const DEVICE_LIMIT_PLUS = Number.POSITIVE_INFINITY;` (UNCHANGED — slice 03-05 will change this)
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-01-2" type="execute">
<title>Add per-tier accessors to backend/src/lib/tier.ts</title>
<read_first>
  - backend/src/lib/tier.ts (existing dual-surface pattern in lines 61-105)
  - backend/src/lib/constants.ts (after task 03-01-1 — exports new constants)
</read_first>
<action>
Edit `backend/src/lib/tier.ts`. Add these accessor functions at the bottom of the file, each following the dual-surface pattern:

```typescript
// --- Per-project insight cap ---
export function getInsightCapForTier(tier: Tier): number {
  return tier === "plus" ? PLUS_INSIGHTS_PER_PROJECT : FREE_INSIGHTS_PER_PROJECT;
}

export function getInsightCap(c: Context<{ Bindings: Env }>): number {
  const tier = (c.get("tier") ?? "free") as Tier;
  return getInsightCapForTier(tier);
}

// --- Per-project conversation cap ---
export function getConversationCapForTier(tier: Tier): number {
  return tier === "plus" ? PLUS_CONVERSATIONS_PER_PROJECT : FREE_CONVERSATIONS_PER_PROJECT;
}

export function getConversationCap(c: Context<{ Bindings: Env }>): number {
  const tier = (c.get("tier") ?? "free") as Tier;
  return getConversationCapForTier(tier);
}

// --- Per-user device cap ---
export function getDeviceCapForTier(tier: Tier): number {
  return tier === "plus" ? DEVICE_LIMIT_PLUS : DEVICE_LIMIT_FREE;
}

export function getDeviceCap(c: Context<{ Bindings: Env }>): number {
  const tier = (c.get("tier") ?? "free") as Tier;
  return getDeviceCapForTier(tier);
}

// --- Auto-sync gate ---
export function isAutoSyncEnabledForTier(tier: Tier): boolean {
  return (AUTO_SYNC_TIERS as readonly string[]).includes(tier);
}

export function isAutoSyncEnabled(c: Context<{ Bindings: Env }>): boolean {
  const tier = (c.get("tier") ?? "free") as Tier;
  return isAutoSyncEnabledForTier(tier);
}
```

Add the imports at the top:
```typescript
import {
  AUTO_SYNC_TIERS,
  DEVICE_LIMIT_FREE,
  DEVICE_LIMIT_PLUS,
  FREE_CONVERSATIONS_PER_PROJECT,
  FREE_INSIGHTS_PER_PROJECT,
  PLUS_CONVERSATIONS_PER_PROJECT,
  PLUS_INSIGHTS_PER_PROJECT,
} from "./constants";
```
(Merge with existing constants import.)

Do not modify existing functions. No call-site changes — accessors are additive.
</action>
<acceptance_criteria>
  - `grep -c "getInsightCapForTier" backend/src/lib/tier.ts` returns ≥ 2 (definition + Context wrapper call)
  - `grep -c "getConversationCapForTier" backend/src/lib/tier.ts` returns ≥ 2
  - `grep -c "getDeviceCapForTier" backend/src/lib/tier.ts` returns ≥ 2
  - `grep -c "isAutoSyncEnabledForTier" backend/src/lib/tier.ts` returns ≥ 2
  - Imports section includes `AUTO_SYNC_TIERS`, `DEVICE_LIMIT_FREE`, `DEVICE_LIMIT_PLUS`, all four PER_PROJECT constants
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-01-3" type="execute">
<title>Unit tests for new accessors in backend/test/lib/tier-enforce.test.ts</title>
<read_first>
  - backend/test/lib/tier-enforce.test.ts (existing test shape — match imports, describe/it structure)
  - backend/src/lib/tier.ts (after task 03-01-2)
</read_first>
<action>
Edit `backend/test/lib/tier-enforce.test.ts`. Add a new describe block at the bottom:

```typescript
describe("per-tier capacity accessors", () => {
  it("getInsightCapForTier returns 10 for free, 50 for plus", () => {
    expect(getInsightCapForTier("free")).toBe(10);
    expect(getInsightCapForTier("plus")).toBe(50);
  });
  it("getConversationCapForTier returns 10 for free, 50 for plus", () => {
    expect(getConversationCapForTier("free")).toBe(10);
    expect(getConversationCapForTier("plus")).toBe(50);
  });
  it("getDeviceCapForTier returns 3 for free and the current Plus value", () => {
    expect(getDeviceCapForTier("free")).toBe(3);
    // Plus device cap currently Infinity (slice 03-05 will change to 10);
    // pin the contract that "plus >= free" rather than a specific value.
    expect(getDeviceCapForTier("plus")).toBeGreaterThan(getDeviceCapForTier("free"));
  });
  it("isAutoSyncEnabledForTier returns false for free, true for plus", () => {
    expect(isAutoSyncEnabledForTier("free")).toBe(false);
    expect(isAutoSyncEnabledForTier("plus")).toBe(true);
  });
});
```

Add the imports at top:
```typescript
import {
  getInsightCapForTier,
  getConversationCapForTier,
  getDeviceCapForTier,
  isAutoSyncEnabledForTier,
} from "../../src/lib/tier";
```

These tests are bug-class assertions per `feedback_test_generality.md` — they assert the contract ("free cap < plus cap, both nonzero, auto-sync gated by tier") not magic numbers. The magic numbers come from constants.ts; if those change, these tests update.

NOTE: tests deliberately reference the CURRENT values to catch accidental future drift. Re-evaluate when constants change.
</action>
<acceptance_criteria>
  - `npm run test --workspace=backend -- tier-enforce` exits 0 with all new tests passing
  - `grep -c "getInsightCapForTier" backend/test/lib/tier-enforce.test.ts` returns ≥ 2 (one in describe, one or more in it)
  - All 4 accessor tests are present (search for the 4 distinct function names)
</acceptance_criteria>
</task>

</tasks>

<verification>
After all three tasks complete:
1. `npm run typecheck --workspace=backend` exits 0
2. `npm run test --workspace=backend` passes 100% with no skips on these test names
3. `git diff --stat backend/src/lib/constants.ts backend/src/lib/tier.ts` shows additive changes (no deletes except the 2 constant value updates)
4. Bug-class test: change `FREE_INSIGHTS_PER_PROJECT` to 11 temporarily in constants.ts → `npm run test --workspace=backend -- tier-enforce` fails on the insight cap test → revert. This proves the tests actually exercise the constants, not just shape.
</verification>
