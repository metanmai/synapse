# Phase 3: Free/Plus Tier Redesign — Patterns Map

**Generated:** 2026-05-29
**Inputs:** 03-CONTEXT.md, existing codebase
**Use:** Executor reference for "what does this file's analog look like?" — concrete code excerpts, no re-derivation.

---

## Slice 03-01 — Tier Constants Centralization

### Analog: `backend/src/lib/constants.ts` (existing, lines 19-38)

Current state:
```typescript
// --- Quota limits ---
export const FREE_MAX_PROJECTS = 5;
export const PLUS_MAX_PROJECTS = 50;

// --- Device limits (CLI-installed keys, separate from API_KEY_MAX_PER_USER) ---
export const DEVICE_LIMIT_FREE = 3;
export const DEVICE_LIMIT_PLUS = Number.POSITIVE_INFINITY;
```

**Required changes:**
- `FREE_MAX_PROJECTS`: 5 → 50 (matches Plus)
- `DEVICE_LIMIT_PLUS`: `Number.POSITIVE_INFINITY` → 10
- ADD `FREE_INSIGHTS_PER_PROJECT = 10`, `PLUS_INSIGHTS_PER_PROJECT = 50`
- ADD `FREE_CONVERSATIONS_PER_PROJECT = 10`, `PLUS_CONVERSATIONS_PER_PROJECT = 50`
- ADD `FREE_AUTO_SYNC = false`, `PLUS_AUTO_SYNC = true` (or single `AUTO_SYNC_TIERS = ['plus']` set)

### Analog: `backend/src/lib/tier.ts` — dual-surface pattern

The existing pattern (lines 61-83): every enforcement helper has TWO entry points — one Context-flavored, one tier-string-flavored. The Context flavor delegates to the tier-string flavor. New helpers MUST follow this — MCP tools and capture daemon need the tier-string path (no Hono Context available).

```typescript
// tier-string flavor (canonical decision)
export function enforceProjectQuotaForTier(currentCount: number, tier: Tier) {
  const max = tier === "plus" ? PLUS_MAX_PROJECTS : FREE_MAX_PROJECTS;
  if (currentCount >= max) {
    throw new AppError(`...`, 403, "TIER_LIMIT");
  }
}

// Context-flavor (thin wrapper)
export function enforceProjectQuota(currentCount: number, c: Context<{ Bindings: Env }>) {
  const tier = (c.get("tier") ?? "free") as Tier;
  enforceProjectQuotaForTier(currentCount, tier);
}
```

**Apply to new helpers:**
- `getInsightCapForTier(tier: Tier): number`
- `getConversationCapForTier(tier: Tier): number`
- `getDeviceCapForTier(tier: Tier): number`
- `isAutoSyncEnabledForTier(tier: Tier): boolean`

---

## Slice 03-02 — 50-Project Cap on Both Tiers

### Analog: `backend/src/api/conversations.ts` (lines 21, 38-60) — quota check pattern

```typescript
import { enforceProjectQuota } from "../lib/tier";
// ...
// Inside POST handler, before auto-create:
const ownedCount = await countOwnedProjects(db, user.id);
enforceProjectQuota(ownedCount, c);  // throws AppError "TIER_LIMIT" if over
```

`enforceProjectQuotaForTier` currently throws `AppError(..., 403, "TIER_LIMIT")`. The new structured error must be `code: "PROJECT_QUOTA_EXCEEDED"` per CONTEXT decisions — that's a code-string change (or a new sibling error).

### Anti-pattern guard: do NOT count shared projects

Per CONTEXT.md, only `role === 'owner'` projects count toward the 50. `countOwnedProjects` in `backend/src/db/queries/projects.ts` already filters by ownership — verify it does (read the function) before using for the cap. If it counts membership too, fix it or use a different helper.

### CLI surface analog: `mcp/src/capture/handoff-sync.ts`

The auto-create path that surfaces the quota error to daemon. Read the existing error-handling shape there to know where the `code: PROJECT_QUOTA_EXCEEDED` response gets caught.

### Brief surface analog: `mcp/src/capture/pull-insights.ts`

Renders a markdown section. New `pull-sync-errors.ts` should mirror this shape — async function that returns `Promise<string>` (markdown), `""` on no errors.

---

## Slice 03-03 — Free Conversation LRU

### Analog: `backend/src/db/queries/insights.ts` — LRU helper shape

Already implements supersession (similar pattern). For conversations, simpler — no supersession, just hard delete:

```typescript
export async function evictOldestConversationForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  // Pick oldest by updated_at ascending
  const { data: oldest, error: selErr } = await db
    .from("conversations")
    .select("id")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: true })
    .limit(1)
    .single();
  if (selErr || !oldest) return null;
  const { error: delErr } = await db
    .from("conversations")
    .delete()
    .eq("id", oldest.id);
  if (delErr) {
    console.error(`[db] evict conversation ${oldest.id} failed: ${delErr.message}`);
    return null;
  }
  return oldest.id;
}
```

### Cascade verification

`supabase/migrations/`: search for `conversation_id` FK declarations on `messages`. If `ON DELETE CASCADE` is not set, ADD MIGRATION `025_conversations_cascade_delete_messages.sql` before relying on eviction.

### API integration: `backend/src/api/conversations.ts` POST handler

Insert AFTER `enforceProjectQuota` call, BEFORE the actual create:
```typescript
const tier = (c.get("tier") ?? "free") as Tier;
if (tier === "free") {
  const conversationCount = await countConversationsForProject(db, projectId);
  if (conversationCount >= getConversationCapForTier(tier)) {
    await evictOldestConversationForProject(db, projectId);
  }
}
```

---

## Slice 03-04 — Insight Cap

### Free path — mirror conversation LRU (above) for insights

`evictOldestInsightForProject(db, projectId)`:
- Pick oldest by `updated_at` WHERE `superseded_by IS NULL` (don't count or evict already-superseded)
- Hard delete (NOT supersede — supersession is for curation, eviction is for capacity)
- Same logging pattern

### Plus path — `backend/src/lib/llm/insight-consolidate.ts` (NEW)

**Mirror:** `backend/src/lib/llm/compact.ts`. Exact shape:

```typescript
// New file, copy structure of compact.ts but for insights.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOldestActiveInsights, createInsight } from "../../db/queries/insights";
import { AnthropicProvider } from "./anthropic";
import { buildInsightConsolidationPrompt } from "./prompts";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const CONSOLIDATION_MAX_TOKENS = 2048;
const OVERFLOW_CHUNK = 10;  // how many oldest to consolidate per pass

export async function consolidateOldestInsights(
  db: SupabaseClient,
  projectId: string,
  apiKey: string,
  model = DEFAULT_MODEL,
): Promise<{ consolidated: number; replacements: number }> {
  const provider = new AnthropicProvider(apiKey, model);
  const oldest = await getOldestActiveInsights(db, projectId, OVERFLOW_CHUNK);
  if (oldest.length === 0) return { consolidated: 0, replacements: 0 };

  const prompt = buildInsightConsolidationPrompt(oldest);
  const raw = await provider.complete(prompt, CONSOLIDATION_MAX_TOKENS);

  const parsed = parseConsolidationResponse(raw);
  if (parsed.length === 0) {
    console.warn(`[consolidate] LLM returned no replacements for project ${projectId} — skipping eviction (user temporarily over cap)`);
    return { consolidated: 0, replacements: 0 };
  }

  for (const item of parsed) {
    await createInsight(db, {
      project_id: projectId,
      user_id: oldest[0].user_id,  // attribute to the user who owned the oldest source
      type: item.type,
      summary: item.summary,
      detail: item.detail ?? null,
      source: { type: "consolidation", agent: "haiku" },
      supersedes: oldest.map((o) => o.id),  // marks all 10 as superseded
    });
  }

  return { consolidated: oldest.length, replacements: parsed.length };
}
```

### `buildInsightConsolidationPrompt()` — new in `backend/src/lib/llm/prompts.ts`

Mirror `buildAggregationPrompt` (lines 27-37). Output a prompt asking Haiku to return JSON like:
```json
[
  {"type": "decision", "summary": "...", "detail": "..."},
  ...
]
```

The prompt must explicitly require:
- 3-5 replacements (not 10 → 10 echo)
- summary ≤12 words
- detail ≤2 sentences
- JSON array as final output, no preamble/postamble

### ctx.waitUntil precedent

`backend/src/index.ts:97` already calls `ctx.waitUntil(runDailyAggregation(env))` from a Cloudflare cron handler. Pattern is:
```typescript
ctx.waitUntil(consolidateOldestInsights(db, projectId, env.ANTHROPIC_API_KEY))
```

To fire from a request handler (POST /api/insights):
```typescript
c.executionCtx.waitUntil(consolidateOldestInsights(...));
```

### Daily catch-up cron

`backend/src/index.ts` already has the scheduled handler shape. ADD a new entry in the cron handler that scans Plus projects with >50 active insights and fires consolidation. Pattern from existing `runDailyAggregation`:
```typescript
// In scheduled handler (existing pattern)
case "0 4 * * *":  // 4 AM UTC (existing slot) or pick a different time
  ctx.waitUntil(retryStuckConsolidations(env));
  break;
```

Update `wrangler.toml` cron triggers if a new slot is needed.

---

## Slice 03-05 — Manual Sync + Device Cap

### CLI streaming-progress analog: `mcp/src/cli/smoke.ts` (lines 53-95)

Existing structured-step pattern:
```typescript
export interface SmokeStep {
  step: number;
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs?: number;
}
```

Apply to `sync.ts`: one step per cycle phase (read queue → push events → pull handoff → pull insights → final summary). Print step name as it starts, status + detail when it completes. Mirror the smoke.ts shape exactly for consistency.

### Daemon cycle analog: `mcp/src/capture/daemon.ts:245-298` — cycle() function

The tier-gate slots in at the TOP of cycle(), before the project loop:
```typescript
async function cycle(): Promise<boolean> {
  if (stopped) return true;

  // Tier-gate: skip auto-sync for Free users
  const tier = await getTierCached(a.api_key, a.api_url);  // 5-min cache w/ IPC invalidation
  if (tier === "free") {
    return true;  // No auto-sync on Free; manual sync via `synapsesync sync`
  }

  // ...existing reconcile + project loop unchanged
}
```

`getTierCached`: new helper that wraps a Map<string, {tier, fetchedAt}>; refetches every 5 min OR when `tierCacheInvalidated` flag is set. The flag is set by the response-piggyback handler (next item).

### Tier-revision piggyback

Modify daemon's existing fetch wrappers (e.g., `runFlushCycle` in `handoff-sync.ts`) to read a `tier_revision` field from response headers or body. On mismatch, set `tierCacheInvalidated = true`. Next cycle entry refreshes the tier.

Backend side: add `tier_revision: <iso-ts of last subscription change>` to common response envelope. Cheapest: a Hono middleware that attaches the header.

### Device identity: `mcp/src/cli/device-id.ts` (NEW)

Pattern: read-or-generate UUID at `~/.synapse/device.json`:
```typescript
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "../capture/handoff-paths.js";

export function getOrCreateMachineId(): string {
  const file = path.join(synapseRoot(), "device.json");
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as { machine_id?: string };
      if (data.machine_id && /^[0-9a-f-]{36}$/i.test(data.machine_id)) return data.machine_id;
    } catch {}
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ machine_id: id, created_at: new Date().toISOString() }, null, 2));
  return id;
}
```

### Migration `025_device_keys_machine_id.sql` — mirror migration 024

```sql
-- 025_device_keys_machine_id.sql
-- Solid per-machine identity for the device cap.
-- Survives hostname renames; re-init from same machine returns existing key.

ALTER TABLE device_keys
  ADD COLUMN IF NOT EXISTS machine_id text DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_keys_user_machine
  ON device_keys(user_id, machine_id)
  WHERE machine_id IS NOT NULL;
```

Existing rows have `machine_id = NULL`; they don't conflict with the unique index (partial). New rows MUST set `machine_id`. Legacy keys without `machine_id` count as one device each but can't be matched on re-init — user has to use the picker.

### Device cap response shape

When backend returns 402 at device-key registration:
```json
{
  "error": "Device limit reached (3/3). Sign out a device to register a new one.",
  "code": "DEVICE_CAP_EXCEEDED",
  "devices": [
    {"id": "<uuid>", "hostname": "MacBook Pro", "last_seen_at": "2026-05-29T...", "registered_at": "2026-04-12T..."}
  ]
}
```

CLI parses `devices`, runs arrow-key picker (use existing prompt-style library or write a minimal inquirer-style selector), calls `DELETE /api/device-keys/<id>`, retries the original init.

---

## Anti-Patterns to Avoid

1. **Silent destructuring of error** — `const { data } = await db.from(...)` drops the `error` field. ALWAYS destructure `error` and check it (per superseded insight `validateApiKey false-negative` lesson).
2. **Single-surface tier helpers** — never write a tier-checking helper that only takes Hono Context. The MCP tools and daemon both have tier-string paths.
3. **Bumping `updated_at` on reads** — eviction LRU keys off `updated_at`. GET endpoints, `list_insights`, `read` must NOT update the row. If you add a tracking field for last-access, use a separate column (`last_accessed_at`) — don't co-opt `updated_at`.
4. **Eviction in the response path for Plus** — Plus consolidation MUST go through `ctx.waitUntil`, not block the POST. The 30s wall-clock budget for waitUntil is more than enough for a single Haiku call.
5. **Hardcoded magic numbers** — every per-tier limit must reference a constant in `tier.ts` / `constants.ts`. Don't write `if (count >= 10)` in business logic.

---

## Files Modified Across All Slices (consolidated for review)

| File | Slices Touched |
|---|---|
| `backend/src/lib/constants.ts` | 03-01 |
| `backend/src/lib/tier.ts` | 03-01, 03-02, 03-03, 03-04, 03-05 |
| `backend/src/api/projects.ts` | 03-02 |
| `backend/src/api/conversations.ts` | 03-02, 03-03 |
| `backend/src/api/insights.ts` | 03-04 |
| `backend/src/api/device-keys.ts` | 03-05 |
| `backend/src/db/queries/conversations.ts` | 03-03 |
| `backend/src/db/queries/insights.ts` | 03-04 |
| `backend/src/db/queries/projects.ts` | 03-02 (verify ownership filter) |
| `backend/src/lib/llm/insight-consolidate.ts` (NEW) | 03-04 |
| `backend/src/lib/llm/prompts.ts` | 03-04 |
| `backend/src/index.ts` | 03-04 (cron), 03-05 (response middleware) |
| `mcp/src/capture/daemon.ts` | 03-05 |
| `mcp/src/capture/handoff-sync.ts` | 03-02, 03-05 |
| `mcp/src/capture/pull-sync-errors.ts` (NEW) | 03-02 |
| `mcp/src/cli/sync.ts` (NEW) | 03-05 |
| `mcp/src/cli/init.ts` | 03-05 (device cap picker) |
| `mcp/src/cli/device-id.ts` (NEW) | 03-05 |
| `mcp/src/cli/commands.ts` | 03-05 (register `sync` command) |
| `frontend/src/routes/(app)/projects/+page.svelte` (or equivalent) | 03-02 |
| `frontend/src/routes/(app)/settings/devices/+page.svelte` (NEW) | 03-05 |
| `supabase/migrations/025_device_keys_machine_id.sql` (NEW) | 03-05 |
| `supabase/migrations/026_conversations_cascade_messages.sql` (IF NEEDED) | 03-03 |
