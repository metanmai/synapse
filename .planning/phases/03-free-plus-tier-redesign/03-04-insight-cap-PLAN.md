---
phase: 03-free-plus-tier-redesign
plan: 4
type: execute
wave: 2
depends_on: [03-01]
files_modified:
  - backend/src/db/queries/insights.ts
  - backend/src/api/insights.ts
  - backend/src/lib/llm/insight-consolidate.ts
  - backend/src/lib/llm/prompts.ts
  - backend/src/index.ts
  - backend/wrangler.toml
  - backend/test/db/queries/insights.test.ts
  - backend/test/lib/llm/insight-consolidate.test.ts
  - scripts/e2e-insight-cap.mjs
autonomous: true
requirements: [TIER-04]

must_haves:
  truths:
    - "Free user's 11th active insight save silently evicts the oldest active insight (by updated_at, WHERE superseded_by IS NULL)"
    - "Plus user's 51st insight save triggers async LLM consolidation via ctx.waitUntil"
    - "Consolidation pulls the 10 oldest active insights, calls Haiku with the new prompt, writes 3-5 replacements that supersede the originals"
    - "On LLM failure, Plus user is temporarily over-cap (no eviction) — daily cron handler retries stuck projects"
    - "Both paths handle the bug class: GET reads don't bump updated_at, eviction only affects superseded_by IS NULL rows"
    - "Plus consolidation does NOT block the POST response — ctx.waitUntil runs it after response is sent"
  artifacts:
    - path: "backend/src/lib/llm/insight-consolidate.ts"
      provides: "consolidateOldestInsights function (mirrors compact.ts shape)"
      contains: "consolidateOldestInsights"
    - path: "backend/src/lib/llm/prompts.ts"
      provides: "buildInsightConsolidationPrompt — Haiku-targeted prompt for 10→3-5 merge"
      contains: "buildInsightConsolidationPrompt"
    - path: "backend/src/api/insights.ts"
      provides: "POST handler with tier-conditional cap path (Free LRU vs Plus async consolidate)"
      contains: "consolidateOldestInsights"
    - path: "scripts/e2e-insight-cap.mjs"
      provides: "E2E asserting Free LRU + Plus async consolidation bug classes"
      contains: "PLUS-CONSOLIDATE"
  key_links:
    - from: "backend/src/api/insights.ts"
      to: "backend/src/lib/llm/insight-consolidate.ts:consolidateOldestInsights"
      via: "import { consolidateOldestInsights }"
      pattern: "ctx.waitUntil"
    - from: "backend/src/lib/llm/insight-consolidate.ts"
      to: "backend/src/lib/llm/prompts.ts:buildInsightConsolidationPrompt"
      via: "import { buildInsightConsolidationPrompt }"
      pattern: "buildInsightConsolidationPrompt"
---

<objective>
Two distinct paths sharing a check in POST /api/insights:

- **Free path**: at 10-insight cap, silently evict the oldest active insight by `updated_at`. Mirror the conversation LRU from slice 03-03 but adapted for insights (filter `superseded_by IS NULL` on both count + select).
- **Plus path**: at 50-insight cap, fire `ctx.waitUntil(consolidateOldestInsights(...))` to run an LLM merge of the oldest 10 into 3-5 replacements via Haiku. Return the POST response immediately; consolidation runs in the background. Compensation: on LLM failure, log + skip eviction (user temporarily over-cap, daily cron retries).

Mirrors the existing `compact.ts` shape exactly. ctx.waitUntil precedent at `backend/src/index.ts:97`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md
@.planning/phases/03-free-plus-tier-redesign/03-PATTERNS.md
@backend/src/api/insights.ts
@backend/src/db/queries/insights.ts
@backend/src/lib/llm/compact.ts
@backend/src/lib/llm/prompts.ts
@backend/src/lib/llm/anthropic.ts
@backend/src/index.ts
@backend/wrangler.toml
@supabase/migrations/024_insights_supersession.sql
</context>

<tasks>

<task id="03-04-1" type="execute">
<title>Add evictOldestInsightForProject + getOldestActiveInsights + countActiveInsightsForProject queries</title>
<read_first>
  - backend/src/db/queries/insights.ts (existing listInsights at line 81 — filter pattern for superseded_by IS NULL)
  - backend/src/db/queries/conversations.ts (sister LRU helper from 03-03 for reference)
</read_first>
<action>
Edit `backend/src/db/queries/insights.ts`. Add three helpers:

```typescript
/**
 * Count active (non-superseded) insights in a project. Used by the per-tier
 * cap path. Free cap = 10, Plus cap = 50.
 */
export async function countActiveInsightsForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<number> {
  const { count, error } = await db
    .from("insights")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("superseded_by", null);
  if (error) {
    console.error(`[db] countActiveInsights ${projectId}: ${error.message}`);
    throw error;
  }
  return count ?? 0;
}

/**
 * Fetch the N oldest ACTIVE insights for a project, ordered by updated_at ASC.
 * Used by Plus consolidation (LLM merges these N into 3-5 replacements) and
 * indirectly by Free eviction (n=1).
 *
 * Returns full insight rows so consolidation has summary + detail + user_id.
 */
export async function getOldestActiveInsights(
  db: SupabaseClient,
  projectId: string,
  n: number,
): Promise<Insight[]> {
  const { data, error } = await db
    .from("insights")
    .select("id, project_id, user_id, type, summary, detail, source, created_at, updated_at, superseded_by")
    .eq("project_id", projectId)
    .is("superseded_by", null)
    .order("updated_at", { ascending: true })
    .limit(n);
  if (error) {
    console.error(`[db] getOldestActiveInsights ${projectId}: ${error.message}`);
    throw error;
  }
  return (data ?? []) as Insight[];
}

/**
 * Evict the single oldest active insight in a project (Free LRU path).
 * Hard delete. Returns the evicted ID or null on no-op.
 *
 * NOTE: this is NOT supersession — supersession is for curation. Eviction
 * is for capacity and the row is gone forever (no superseded_by stamp,
 * no recoverable history). This is intentional per CONTEXT.md.
 */
export async function evictOldestInsightForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const oldest = await getOldestActiveInsights(db, projectId, 1);
  if (oldest.length === 0) return null;
  const id = oldest[0].id;
  const { error } = await db.from("insights").delete().eq("id", id);
  if (error) {
    console.error(`[db] evictOldestInsightForProject ${id}: ${error.message}`);
    return null;
  }
  return id;
}
```

Re-export via the queries index file if applicable.
</action>
<acceptance_criteria>
  - `grep -c "countActiveInsightsForProject\|getOldestActiveInsights\|evictOldestInsightForProject" backend/src/db/queries/insights.ts` returns ≥ 3
  - All three helpers filter on `superseded_by IS NULL` for active-only semantics
  - All destructure `error` and log (no silent error swallow)
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-04-2" type="execute">
<title>buildInsightConsolidationPrompt in prompts.ts</title>
<read_first>
  - backend/src/lib/llm/prompts.ts (existing buildAggregationPrompt at line 27 — mirror its shape)
</read_first>
<action>
Add to `backend/src/lib/llm/prompts.ts`:

```typescript
interface InsightForConsolidation {
  id: string;
  type: string;
  summary: string;
  detail: string | null;
  updated_at: string;
}

export function buildInsightConsolidationPrompt(insights: InsightForConsolidation[]): string {
  const lines = insights.map(
    (i, idx) =>
      `${idx + 1}. [${i.type}] ${i.summary}${i.detail ? ` — ${i.detail}` : ""} (updated ${i.updated_at})`,
  );
  return `You are consolidating ${insights.length} older insights from an AI coding project into 3-5 merged replacements. Preserve the load-bearing facts; drop transient or already-completed items.

RULES (HARD):
- Output ONLY a JSON array, no preamble, no postamble, no code fence.
- 3-5 items maximum.
- Each item: {"type": "<one of: decision, learning, preference, architecture, action_item>", "summary": "<string, ≤12 words>", "detail": "<string OR omitted, ≤2 sentences if present>"}
- Combine near-duplicates into a single entry.
- If multiple older insights point to the same fact, keep one merged version.
- If an action_item is now complete (referenced by a later decision), drop it.
- Be concise — these will appear in every future SessionStart brief, so every word costs.

INPUT INSIGHTS:
${lines.join("\n")}

OUTPUT (JSON array only):`;
}
```

The prompt is the contract. The parser (next task) reads this format.
</action>
<acceptance_criteria>
  - `grep -c "buildInsightConsolidationPrompt" backend/src/lib/llm/prompts.ts` returns 1
  - The prompt explicitly says "JSON array only" and "≤12 words"
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-04-3" type="execute">
<title>insight-consolidate.ts — async consolidation entry point</title>
<read_first>
  - backend/src/lib/llm/compact.ts (mirror — exact same shape: getRecent → buildPrompt → provider.complete → save)
  - backend/src/lib/llm/anthropic.ts (AnthropicProvider.complete signature)
  - backend/src/db/queries/insights.ts (createInsight signature with supersedes — already supported)
</read_first>
<action>
Create new file `backend/src/lib/llm/insight-consolidate.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInsight, getOldestActiveInsights } from "../../db/queries/insights";
import { AnthropicProvider } from "./anthropic";
import { buildInsightConsolidationPrompt } from "./prompts";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const CONSOLIDATION_MAX_TOKENS = 2048;
const OVERFLOW_CHUNK = 10;

interface ConsolidationReplacement {
  type: "decision" | "learning" | "preference" | "architecture" | "action_item";
  summary: string;
  detail?: string;
}

export interface ConsolidationResult {
  consolidated: number;
  replacements: number;
  error?: string;
}

export function parseConsolidationResponse(raw: string): ConsolidationReplacement[] {
  // Strip markdown code fences if the LLM leaked them
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const validTypes = ["decision", "learning", "preference", "architecture", "action_item"];
  return arr.filter((item): item is ConsolidationReplacement => {
    if (typeof item !== "object" || item === null) return false;
    const o = item as Record<string, unknown>;
    if (typeof o.type !== "string" || !validTypes.includes(o.type)) return false;
    if (typeof o.summary !== "string" || o.summary.length === 0) return false;
    if (o.detail !== undefined && typeof o.detail !== "string") return false;
    return true;
  });
}

export async function consolidateOldestInsights(
  db: SupabaseClient,
  projectId: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<ConsolidationResult> {
  const provider = new AnthropicProvider(apiKey, model);
  const oldest = await getOldestActiveInsights(db, projectId, OVERFLOW_CHUNK);
  if (oldest.length === 0) return { consolidated: 0, replacements: 0 };

  const prompt = buildInsightConsolidationPrompt(
    oldest.map((o) => ({
      id: o.id,
      type: o.type,
      summary: o.summary,
      detail: o.detail,
      updated_at: o.updated_at,
    })),
  );

  let raw: string;
  try {
    raw = await provider.complete(prompt, CONSOLIDATION_MAX_TOKENS);
  } catch (e) {
    console.error(`[consolidate] LLM call failed for project ${projectId}: ${e instanceof Error ? e.message : e}`);
    return { consolidated: 0, replacements: 0, error: "llm_failed" };
  }

  const replacements = parseConsolidationResponse(raw);
  if (replacements.length === 0) {
    console.warn(`[consolidate] LLM returned no valid replacements for project ${projectId} (raw=${raw.slice(0, 200)})`);
    return { consolidated: 0, replacements: 0, error: "no_valid_replacements" };
  }

  const originalIds = oldest.map((o) => o.id);
  const userId = oldest[0].user_id;

  for (const r of replacements) {
    try {
      await createInsight(db, {
        project_id: projectId,
        user_id: userId,
        type: r.type,
        summary: r.summary,
        detail: r.detail ?? null,
        source: { type: "consolidation", agent: "haiku" },
        supersedes: originalIds,
      });
    } catch (e) {
      console.error(`[consolidate] createInsight failed for project ${projectId}: ${e instanceof Error ? e.message : e}`);
      // Continue — partial replacement is better than rollback
    }
  }

  return { consolidated: oldest.length, replacements: replacements.length };
}
```
</action>
<acceptance_criteria>
  - File `backend/src/lib/llm/insight-consolidate.ts` exists
  - Exports `consolidateOldestInsights` and `parseConsolidationResponse`
  - `consolidateOldestInsights` returns a non-throwing result (errors logged + returned in `.error` field)
  - All three failure modes covered (LLM throw, empty/invalid JSON, partial createInsight)
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-04-4" type="execute">
<title>Wire tier-conditional cap path into POST /api/insights</title>
<read_first>
  - backend/src/api/insights.ts (existing POST handler at line 50)
  - backend/src/lib/tier.ts (after 03-01: getInsightCapForTier available)
  - backend/src/index.ts (existing ctx.waitUntil at line 97 — pattern)
</read_first>
<action>
Edit `backend/src/api/insights.ts` POST handler. AFTER `await requireRole(...)` and BEFORE the `await createInsight(...)`:

```typescript
import { getInsightCapForTier, type Tier } from "../lib/tier";
import { countActiveInsightsForProject, evictOldestInsightForProject } from "../db/queries/insights";
import { consolidateOldestInsights } from "../lib/llm/insight-consolidate";

// ... inside POST handler:
const tier = (c.get("tier") ?? "free") as Tier;
const cap = getInsightCapForTier(tier);
const activeCount = await countActiveInsightsForProject(db, body.project_id);

if (activeCount >= cap) {
  if (tier === "free") {
    // Silent LRU eviction — destructive per CONTEXT.md
    await evictOldestInsightForProject(db, body.project_id);
  } else {
    // Plus: async LLM consolidation. Fires AFTER the new insight is saved
    // (so the user isn't blocked on Haiku). The new insight transiently
    // pushes the user to cap+1, then the consolidation reduces 10→3-5
    // bringing the active count back below cap within ~5-15s.
    const apiKey = c.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      c.executionCtx.waitUntil(
        consolidateOldestInsights(db, body.project_id, apiKey).catch((e) => {
          console.error(`[consolidate] background task threw: ${e instanceof Error ? e.message : e}`);
        }),
      );
    }
  }
}
// ... continue to existing createInsight call
```

The order: count, branch on tier, evict (Free) OR schedule waitUntil (Plus), THEN create the new insight. The new insight is the (N+1)th; after eviction/consolidation completes, active count is back at N.
</action>
<acceptance_criteria>
  - `grep -c "evictOldestInsightForProject\|consolidateOldestInsights" backend/src/api/insights.ts` returns ≥ 2
  - `grep -c "c.executionCtx.waitUntil" backend/src/api/insights.ts` returns 1
  - Plus path catches errors from waitUntil so unhandled rejection doesn't escape
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-04-5" type="execute">
<title>Daily cron: retry consolidation for stuck Plus projects</title>
<read_first>
  - backend/src/index.ts (line 97 area — existing scheduled handler with runDailyAggregation)
  - backend/wrangler.toml (cron triggers config)
</read_first>
<action>
In `backend/src/index.ts` scheduled handler, after `runDailyAggregation(env)` (or in the same handler, parallel waitUntil):

```typescript
ctx.waitUntil(retryStuckConsolidations(env));
```

Create `retryStuckConsolidations(env)` either as a sibling function in `index.ts` or as a new file `backend/src/cron/retry-consolidations.ts`:

```typescript
export async function retryStuckConsolidations(env: Env): Promise<void> {
  const db = createDbFromEnv(env);
  // Find Plus projects with >50 active insights
  const { data: overflowing, error } = await db
    .from("projects")
    .select(`id, subscriptions!inner(status)`)  // adjust to actual subscription join
    .gt(/* count expression — use a view or RPC if direct count not feasible */)
    /* ... */;
  // For simplicity: select all projects, then for each Plus project, count and check
  // ... (or use a SQL view that pre-computes overflow)

  for (const project of overflowing ?? []) {
    try {
      await consolidateOldestInsights(db, project.id, env.ANTHROPIC_API_KEY);
    } catch (e) {
      console.error(`[cron] retry consolidation for ${project.id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
```

If `wrangler.toml` doesn't already have a daily cron, add one:
```toml
[triggers]
crons = ["0 4 * * *"]  # 4 AM UTC daily
```

Match whatever cron expression `runDailyAggregation` is already using (don't add a duplicate).
</action>
<acceptance_criteria>
  - `grep -c "retryStuckConsolidations" backend/src/index.ts` returns ≥ 1
  - Cron trigger exists in wrangler.toml
  - The cron handler does not throw on no-overflowing-projects (graceful empty case)
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-04-6" type="execute">
<title>Unit tests for parseConsolidationResponse + consolidate happy path</title>
<read_first>
  - backend/test/db/queries/insights.test.ts (existing mock patterns)
  - backend/src/lib/llm/insight-consolidate.ts (after 03-04-3)
</read_first>
<action>
Create `backend/test/lib/llm/insight-consolidate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseConsolidationResponse } from "../../../src/lib/llm/insight-consolidate";

describe("parseConsolidationResponse", () => {
  it("parses a clean JSON array", () => {
    const raw = `[{"type":"decision","summary":"X chose A","detail":"because Y"},{"type":"learning","summary":"Z fails when W"}]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(2);
    expect(r[0].summary).toBe("X chose A");
  });
  it("strips markdown code fences", () => {
    const raw = "```json\n[{\"type\":\"decision\",\"summary\":\"x\"}]\n```";
    expect(parseConsolidationResponse(raw)).toHaveLength(1);
  });
  it("returns empty array on invalid JSON", () => {
    expect(parseConsolidationResponse("not json")).toEqual([]);
    expect(parseConsolidationResponse("[")).toEqual([]);
    expect(parseConsolidationResponse('{"not": "array"}')).toEqual([]);
  });
  it("filters out invalid items (bad type, missing summary)", () => {
    const raw = `[{"type":"foo","summary":"x"},{"type":"decision"},{"type":"decision","summary":"good"}]`;
    const r = parseConsolidationResponse(raw);
    expect(r).toHaveLength(1);
    expect(r[0].summary).toBe("good");
  });
  it("accepts detail as optional", () => {
    const raw = `[{"type":"decision","summary":"no detail"}]`;
    expect(parseConsolidationResponse(raw)).toHaveLength(1);
  });
});
```

Also extend `backend/test/db/queries/insights.test.ts` with mock tests for `evictOldestInsightForProject` and `countActiveInsightsForProject` (mirror the conversation LRU test shape from 03-03).
</action>
<acceptance_criteria>
  - File `backend/test/lib/llm/insight-consolidate.test.ts` exists with 5+ tests passing
  - `backend/test/db/queries/insights.test.ts` has new tests for the two new query helpers
  - `npm run test --workspace=backend -- insight-consolidate` exits 0
  - All tests are bug-class — parser handles malformed input, fence-stripped JSON, missing fields. Not magic-string assertions.
</acceptance_criteria>
</task>

<task id="03-04-7" type="execute">
<title>E2E for both Free LRU and Plus async consolidation</title>
<read_first>
  - scripts/e2e-smoke.mjs (E2E pattern)
</read_first>
<action>
Create `scripts/e2e-insight-cap.mjs`:

PART A — FREE LRU (env `SYNAPSE_E2E_FREE_API_KEY`):
1. Pick a test project, clear its insights.
2. POST 10 insights named `e2e-free-${i}`.
3. POST the 11th. Assert: active count == 10. `e2e-free-1` is gone. `e2e-free-2` through `e2e-free-11` present.
4. Cleanup: delete all test insights.

PART B — PLUS ASYNC CONSOLIDATION (env `SYNAPSE_E2E_PLUS_API_KEY`):
1. Pick a test project, clear its insights.
2. POST 50 insights named `e2e-plus-${i}`.
3. POST the 51st. Immediately the POST returns 201 (NOT blocked on consolidation).
4. Poll for up to 30 seconds: list_insights and watch the active count drop from 51 to ≤50.
5. Once dropped: assert that ≥3 of the oldest are now superseded (their `superseded_by` is non-null in the included_superseded list).
6. Assert: the new replacements have `source.type === "consolidation"`.
7. Cleanup: delete all test insights including consolidations.

Skip PART B with a warning if no `SYNAPSE_E2E_PLUS_API_KEY` is set.

Exit 0 on full pass, 1 on any phase fail.
</action>
<acceptance_criteria>
  - File `scripts/e2e-insight-cap.mjs` exists
  - Running with both keys exits 0
  - Self-cleaning: no `e2e-free-*` or `e2e-plus-*` remain
  - The PLUS phase confirms `ctx.waitUntil` actually ran (active count dropped) and consolidations have the right source field
</acceptance_criteria>
</task>

</tasks>

<verification>
1. `npm run lint && npm run typecheck && npm run test` exit 0
2. `node scripts/e2e-insight-cap.mjs` passes (both PARTS if both keys set)
3. Manual Plus: at 51 insights, observe in Supabase logs that consolidation ran ~5-15s after the POST
4. Manual cron: trigger the scheduled handler manually (`wrangler tail` or wrangler dev triggers) and confirm `retryStuckConsolidations` runs without error on no-overflow accounts
</verification>
