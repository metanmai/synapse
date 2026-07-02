# AI Project Correlation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]` checkboxes. Each phase ends green (lint+typecheck+unit pass locally) and is committed + pushed.

**Goal:** Keyless captures (browser/non-code) get embedding-based project assignment at capture; a daily reconciler LLM-rechecks ambiguous cases and merges fragmented projects — and every feature, including the browser path, is covered by automated tests that stay green.

**Spec:** `docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md`

**Architecture:** Eager assign + lazy merge. Tier-3 AI resolver fires only when git/cwd is absent. Reconciler runs on the existing daily cron + a secret-guarded internal trigger for E2E. Pure decision logic is isolated for deterministic unit testing.

**Tech stack:** Cloudflare Workers (Hono) backend, Supabase Postgres + pgvector, nomic-embed-text-v1.5 (768-dim), `AnthropicProvider` LLM client, vitest (`@cloudflare/vitest-pool-workers` for backend, node/jsdom for mcp+extension), MV3 extension.

## Test topology (governs every phase)
- **verify job** (every push/PR, no secrets, runs locally via pre-push): pure-logic unit + mocked-backend contract + no-browser full-chain. **This is the green gate I can verify locally.**
- **live E2E** (`scripts/e2e-*.mjs`, metanmai push-to-main only, skip-green without secrets): real deployed backend + real Supabase; self-skips when embeddings inactive.
- No real-Postgres-in-CI layer is introduced (can't verify locally; pgvector RPC is covered by the live layer + mirrors the proven `match_entries`).

---

## Phase 1 — Migration 029 (schema + RPCs + merge-candidates)

### Task 1.1: Write migration `029_conversation_embeddings.sql`

**Files:**
- Create: `supabase/migrations/029_conversation_embeddings.sql`

- [ ] **Step 1: Write the migration** (mirrors `005_pgvector.sql` + `027_rls_remaining_tables.sql` RLS style)

```sql
-- Conversation embeddings + AI project-correlation support.

ALTER TABLE conversations ADD COLUMN embedding vector(768);
CREATE INDEX conversations_embedding_idx ON conversations
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE conversations ADD COLUMN assignment_method text;   -- git | ai_assign | ai_create | manual
ALTER TABLE conversations ADD COLUMN assignment_confidence real;

-- Owner-scoped semantic kNN over conversation embeddings.
CREATE OR REPLACE FUNCTION match_conversations(
  query_embedding vector(768),
  match_user_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 20
) RETURNS TABLE (id uuid, project_id uuid, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT conversations.id, conversations.project_id,
         1 - (conversations.embedding <=> query_embedding) AS similarity
  FROM conversations
  WHERE conversations.user_id = match_user_id
    AND conversations.embedding IS NOT NULL
    AND conversations.status = 'active'
    AND 1 - (conversations.embedding <=> query_embedding) > match_threshold
  ORDER BY conversations.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Merge-candidate state for 2-run hysteresis.
CREATE TABLE project_merge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_low uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_high uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score real NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  UNIQUE (project_low, project_high)
);
CREATE INDEX idx_merge_candidates_owner ON project_merge_candidates(owner_id);

ALTER TABLE project_merge_candidates ENABLE ROW LEVEL SECURITY;
-- service-role only (reconciler runs server-side); no anon/auth policies needed.
```

- [ ] **Step 2: Verify it parses** — `rg -n "vector\(768\)|match_conversations|project_merge_candidates" supabase/migrations/029_conversation_embeddings.sql`. Confirm idempotent-safe shape matches 005/027.
- [ ] **Step 3: Commit** — `git add supabase/migrations/029_conversation_embeddings.sql && git commit -m "feat(db): migration 029 — conversation embeddings + match_conversations RPC + merge-candidates"`; push.

> Note: migration is applied to prod by the `migrate` CI job (`supabase db push`) on metanmai push-to-main. Additive + nullable columns → backward-compatible; existing conversations have `embedding = NULL` until reconciler backfill.

---

## Phase 2 — Pure decision logic (`project-correlation.ts`) + unit tests

### Task 2.1: Pure module

**Files:**
- Create: `backend/src/lib/project-correlation.ts`
- Test: `backend/test/lib/project-correlation.test.ts`
- Modify: `backend/src/lib/constants.ts`

- [ ] **Step 1: Add constants** to `backend/src/lib/constants.ts`

```ts
export const PROJECT_ASSIGN_THRESHOLD = 0.82;
export const PROJECT_CREATE_THRESHOLD = 0.65;
export const PROJECT_MERGE_THRESHOLD = 0.85;
export const RECONCILE_BACKFILL_CAP = 200;
export const RECONCILE_RECHECK_CAP = 50;
export const RECONCILE_OWNERS_PER_RUN = 100;
```

- [ ] **Step 2: Write failing tests** `backend/test/lib/project-correlation.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  decideAssignment, isSyntheticProjectName, chooseMergeTarget,
  orderPair, isStableCandidate,
} from "../../src/lib/project-correlation";

describe("decideAssignment", () => {
  const t = { assign: 0.82, create: 0.65 };
  it("creates when no candidates", () =>
    expect(decideAssignment([], t)).toEqual({ action: "create", confidence: 0 }));
  it("creates when top below create floor", () =>
    expect(decideAssignment([{ projectId: "p", score: 0.5 }], t).action).toBe("create"));
  it("assigns (ambiguous) in the middle band", () => {
    const r = decideAssignment([{ projectId: "p", score: 0.7 }], t);
    expect(r).toMatchObject({ action: "assign", projectId: "p", confidence: 0.7 });
  });
  it("assigns (confident) at/above assign threshold", () =>
    expect(decideAssignment([{ projectId: "p", score: 0.9 }], t).action).toBe("assign"));
  it("picks the highest-scoring candidate", () =>
    expect(decideAssignment([{ projectId: "a", score: 0.7 }, { projectId: "b", score: 0.88 }], t).projectId).toBe("b"));
});

describe("isSyntheticProjectName", () => {
  it("flags cwd hashes, capture hosts, placeholder", () => {
    expect(isSyntheticProjectName("cwd_a1b2c3d4e5f6")).toBe(true);
    expect(isSyntheticProjectName("chatgpt.com")).toBe(true);
    expect(isSyntheticProjectName("claude.ai")).toBe(true);
    expect(isSyntheticProjectName("New project")).toBe(true);
  });
  it("does not flag real names", () =>
    expect(isSyntheticProjectName("synapse")).toBe(false));
});

describe("chooseMergeTarget (real absorbs buckets)", () => {
  const real = { id: "r", name: "synapse", createdAt: 200 };
  const bucket = { id: "b", name: "chatgpt.com", createdAt: 100 };
  it("real survives even when newer", () => {
    const { target, source } = chooseMergeTarget(real, bucket);
    expect(target.id).toBe("r"); expect(source.id).toBe("b");
  });
  it("both real → earliest created wins", () => {
    const a = { id: "a", name: "alpha", createdAt: 50 };
    const b = { id: "b", name: "beta", createdAt: 60 };
    expect(chooseMergeTarget(a, b).target.id).toBe("a");
  });
});

describe("orderPair / isStableCandidate", () => {
  it("orders deterministically", () => expect(orderPair("z", "a")).toEqual(["a", "z"]));
  it("stable only if first seen before this run", () => {
    expect(isStableCandidate(100, 200)).toBe(true);
    expect(isStableCandidate(200, 200)).toBe(false);
  });
});
```

- [ ] **Step 3: Run, confirm fail** — `cd backend && ../node_modules/.bin/vitest run test/lib/project-correlation.test.ts` (expect: module not found).
- [ ] **Step 4: Implement** `backend/src/lib/project-correlation.ts`

```ts
import { CAPTURE_HOSTS } from "@synapse/shared/capture-hosts";

export const PROVISIONAL_PROJECT_NAME = "New project";
export interface Candidate { projectId: string; score: number; }
export interface ProjLite { id: string; name: string; createdAt: number; }

export function decideAssignment(
  candidates: Candidate[],
  t: { assign: number; create: number },
): { action: "assign" | "create"; projectId?: string; confidence: number } {
  const top = [...candidates].sort((a, b) => b.score - a.score)[0];
  if (!top || top.score < t.create) return { action: "create", confidence: top?.score ?? 0 };
  return { action: "assign", projectId: top.projectId, confidence: top.score };
}

export function isSyntheticProjectName(name: string): boolean {
  if (/^cwd_[a-f0-9]{12}$/.test(name)) return true;
  if (name === PROVISIONAL_PROJECT_NAME) return true;
  return (CAPTURE_HOSTS as readonly string[]).includes(name);
}

export function chooseMergeTarget(a: ProjLite, b: ProjLite): { target: ProjLite; source: ProjLite } {
  const aSyn = isSyntheticProjectName(a.name);
  const bSyn = isSyntheticProjectName(b.name);
  if (aSyn !== bSyn) {
    const target = aSyn ? b : a;       // non-synthetic survives
    return { target, source: target === a ? b : a };
  }
  const target = a.createdAt <= b.createdAt ? a : b;  // tie → earliest created
  return { target, source: target === a ? b : a };
}

export function orderPair(idA: string, idB: string): [string, string] {
  return idA <= idB ? [idA, idB] : [idB, idA];
}

export function isStableCandidate(firstSeenAtMs: number, runStartMs: number): boolean {
  return firstSeenAtMs < runStartMs;
}
```

- [ ] **Step 5: Run, confirm pass.**
- [ ] **Step 6: Commit** `feat(correlation): pure decision logic (bands, synthetic-name, merge-target, hysteresis)`; push.

---

## Phase 3 — Capture-path Tier-3 resolver + contract tests

### Task 3.1: kNN helper + resolver orchestration

**Files:**
- Modify: `backend/src/db/queries/conversations.ts` (kNN helper; createConversation accepts embedding + assignment fields)
- Create: `backend/src/lib/ai-resolve.ts` (impure orchestration: embed → kNN → decide)
- Modify: `backend/src/api/conversations.ts` (wire Tier-3 into the `if (!projectId)` branch)
- Test: `backend/test/api/conversations-ai-resolve.test.ts` (contract, mocked Supabase + `vi.mock` embeddings)

- [ ] **Step 1: kNN helper** in `conversations.ts`

```ts
export async function matchConversations(
  db: SupabaseClient, userId: string, embedding: number[], threshold: number, count = 20,
): Promise<{ project_id: string; similarity: number }[]> {
  const { data, error } = await db.rpc("match_conversations", {
    query_embedding: embedding, match_user_id: userId,
    match_threshold: threshold, match_count: count,
  });
  if (error) { console.error("match_conversations failed", error); return []; }
  return data ?? [];
}
```

- [ ] **Step 2: Extend `createConversation`** to accept optional `embedding`, `assignment_method`, `assignment_confidence` and include them in the insert column set (default `assignment_method` to `"git"` for the existing path).

- [ ] **Step 3: Orchestrator** `backend/src/lib/ai-resolve.ts`

```ts
import { embedTexts, embeddingConfigFromEnv } from "./embeddings";
import { matchConversations } from "../db/queries/conversations";
import { decideAssignment, type Candidate } from "./project-correlation";
import { PROJECT_ASSIGN_THRESHOLD, PROJECT_CREATE_THRESHOLD } from "./constants";

export interface AiResolveResult {
  embedding: number[] | null;
  decision: { action: "assign" | "create"; projectId?: string; confidence: number };
}

// fetchFn injectable for tests (embedTexts already supports it).
export async function aiResolveProject(
  db: SupabaseClient, env: Env, userId: string, seed: string, fetchFn = globalThis.fetch,
): Promise<AiResolveResult | null> {
  const cfg = embeddingConfigFromEnv(env);
  if (!cfg) return null;                                  // embeddings not configured → caller falls back
  const vecs = await embedTexts([seed], "search_document", cfg, fetchFn);
  if (!vecs) return null;                                 // service down → caller falls back
  const embedding = vecs[0];
  const rows = await matchConversations(db, userId, embedding, PROJECT_CREATE_THRESHOLD);
  const byProject = new Map<string, number>();
  for (const r of rows) byProject.set(r.project_id, Math.max(byProject.get(r.project_id) ?? 0, r.similarity));
  const candidates: Candidate[] = [...byProject].map(([projectId, score]) => ({ projectId, score }));
  return { embedding, decision: decideAssignment(candidates, { assign: PROJECT_ASSIGN_THRESHOLD, create: PROJECT_CREATE_THRESHOLD }) };
}
```

- [ ] **Step 4: Wire into route** `backend/src/api/conversations.ts` `if (!projectId)` branch. Keyless predicate + Tier-3:

```ts
const wc = body.working_context ?? {};
const keyless = !wc.git_origin_url &&
  (typeof wc.projectPath === "string" ? wc.projectPath.startsWith("synapse://") : !wc.cwd);

let embedding: number[] | null = null;
let assignmentMethod = "git";
let assignmentConfidence: number | null = null;

if (keyless) {
  const seed = `${body.title ?? ""}\n${firstUserMessage(body) ?? ""}`.trim();
  const ai = seed ? await aiResolveProject(c.env.DB, c.env, userId, seed) : null;
  if (ai) {
    embedding = ai.embedding;
    assignmentConfidence = ai.decision.confidence;
    if (ai.decision.action === "assign") {
      projectId = ai.decision.projectId!; assignmentMethod = "ai_assign";
    } else {
      assignmentMethod = "ai_create";
      projectId = await findOrCreateProjectByGit(db, userId,
        { git_basename: body.title?.trim() || PROVISIONAL_PROJECT_NAME }, { onWillCreate });
    }
  }
}
// fall through to today's git path when !keyless OR ai === null (embedding off/down)
if (!projectId) { /* existing git derivation unchanged */ }
```

Then pass `embedding/assignmentMethod/assignmentConfidence` to `createConversation`.

- [ ] **Step 5: Contract tests** `backend/test/api/conversations-ai-resolve.test.ts` (follow `backend/test/helpers/supabase-mock.ts`; `vi.mock("../../src/lib/embeddings")` to return a canned vector; seed `match_conversations` rpc on the mock db):
  - keyless + a high-similarity neighbour → conversation created with `assignment_method = "ai_assign"`, `project_id` = neighbour's project.
  - keyless + no neighbours → `ai_create`, a new project.
  - keyless + embeddings mock returns `null` → falls back to host-bucket path (`assignment_method = "git"`), conversation still created (degradation).
  - non-keyless (has `git_origin_url`) → Tier-1 unchanged, embeddings never called.

- [ ] **Step 6: Run unit suite locally, confirm green. Commit** `feat(correlation): Tier-3 AI resolver at capture (embed→kNN→assign/create) + fallback`; push.

---

## Phase 4 — Reconciler + internal trigger + contract tests

### Task 4.1: Reconciler module

**Files:**
- Create: `backend/src/cron/reconcile-projects.ts` — `export async function reconcileProjects(env: Env): Promise<ReconcileSummary>`
- Modify: `backend/src/index.ts` — add `ctx.waitUntil(reconcileProjects(env))` in the `"0 3 * * *"` branch.
- Modify: `backend/src/lib/llm/prompts.ts` — `buildProjectRecheckPrompt`, `buildProjectNamingPrompt`.
- Modify: `backend/src/db/queries/projects.ts` — merge-candidate upsert/select/mark; project-centroid query.
- Test: `backend/test/cron/reconcile-projects.test.ts` (mocked db; `vi.mock` embeddings + `llm/anthropic`).

- [ ] **Step 1: Reconciler skeleton** (4 capped steps; LLM/embeddings degrade by skipping):

```ts
export async function reconcileProjects(env: Env): Promise<ReconcileSummary> {
  const db = createSupabaseClient(env);
  if (!db) return EMPTY;
  const cfg = embeddingConfigFromEnv(env);
  const llmKey = env.COMPACTION_LLM_KEY;                 // reuse consolidation key
  const runStart = Date.now();
  // 1. backfill embeddings (cfg present), cap RECONCILE_BACKFILL_CAP
  // 2. recheck ambiguous ai_assign rows via LLM (llmKey present), cap RECONCILE_RECHECK_CAP
  // 3. merge detection: per owner (cap RECONCILE_OWNERS_PER_RUN), centroid sim ≥ MERGE,
  //    upsert candidate (orderPair); if isStableCandidate(first_seen_at, runStart) → chooseMergeTarget → merge_projects RPC → mark merged + activity_log
  // 4. name ai_create projects with provisional name via LLM (llmKey present); store once
  return summary;
}
```

- [ ] **Step 2: Internal trigger endpoint** `POST /api/internal/reconcile` (new route file or in an existing admin router):

```ts
app.post("/api/internal/reconcile", async (c) => {
  const token = c.env.INTERNAL_TRIGGER_TOKEN;
  if (!token) return c.notFound();                        // feature off
  const provided = c.req.header("x-synapse-internal-token") ?? "";
  if (!timingSafeEqualStr(provided, token)) return c.json({ error: "unauthorized" }, 401);
  const summary = await reconcileProjects(c.env);
  return c.json({ ok: true, summary });
});
```

- [ ] **Step 3: Contract tests** `backend/test/cron/reconcile-projects.test.ts`:
  - merge fires only when candidate pre-exists (stable) — seed a candidate with `first_seen_at < runStart`, mocked centroid sim ≥ 0.85 → asserts `merge_projects` rpc called with target = non-synthetic.
  - new candidate (first seen this run) → NO merge, candidate upserted.
  - no `COMPACTION_LLM_KEY` → recheck + naming skipped, no throw.
  - no embedding cfg → backfill skipped, no throw.
  - And `backend/test/api/internal-reconcile.test.ts`: 404 without env token; 401 wrong token; 200 + reconciler invoked with right token.

- [ ] **Step 4: Run locally green. Commit** `feat(correlation): daily reconciler (backfill/recheck/merge/name) + internal trigger`; push.

---

## Phase 5 — Browser glue: export-refactor + no-browser full-chain test

### Task 5.1: Behavior-preserving export refactors

**Files:**
- Modify: `extension/src/content/main.ts`, `extension/src/content/relay.ts`, `extension/src/worker/index.ts`

- [ ] **Step 1: `main.ts`** — wrap IIFE body in `export function installFetchHook(win = window, loc = location, doc = document)`; keep `origFetch/readAll/post/pingIfVisible` as locals; bottom: `if (typeof window !== "undefined") installFetchHook();`. Also `export function makeHookedFetch(origFetch, adapter, post)` (the wrapped-fetch factory) for pure testing.
- [ ] **Step 2: `relay.ts`** — `export function handleRelayMessage(event)` + `export function installRelay(target = window)`; bottom guard.
- [ ] **Step 3: `worker/index.ts`** — `export function installWorker()` (move the `onMessage` listener inside) + `export { postCapture, flush, handleTurn }`; bottom: `if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) installWorker();`.
- [ ] **Step 4: Re-run existing extension tests + bundle** — `vitest run` (adapters/buffer/anti-drift still pass), then `npm run bundle -w @synapse/extension`; confirm `extension/dist/*.js` still valid IIFEs (the guard call preserves runtime). Commit `refactor(extension): extract install* seams (no behavior change) for testability`; push.

### Task 5.2: jsdom env + chrome stub + full-chain test

**Files:**
- Create: `extension/vitest.config.ts` (jsdom for the chain test; keep node for pure tests via per-file env or `environmentMatchGlobs`)
- Create: `extension/test/setup-chrome.ts` (in-memory `chrome` stub)
- Create: `extension/test/full-chain.test.ts`

- [ ] **Step 1: Failing full-chain test** — build fake SSE `Response` from golden fixtures (reuse `buildSSE`), call `makeHookedFetch`/`installFetchHook` with a stub `origFetch` returning it; route `post` → `handleRelayMessage` → worker `onMessage` (chrome stub) → `postCapture` to an in-process `startIngestServer({port:0})` with a stub `sync`; assert `sync` receives a `CapturedSession` with `tool:"claude-ai"`, `projectPath:"synapse://browser/claude.ai"`, reassembled assistant content, and that token-shaped secrets are scrubbed. Repeat for chatgpt fixture.
- [ ] **Step 2: chrome stub** `setup-chrome.ts` — in-memory `storage.local` (returns `{synapseToken, synapsePort}`), `storage.session` maps, `runtime.onMessage` registry + `runtime.sendMessage` dispatching to registered listeners, no-op `action.setBadgeText`.
- [ ] **Step 3: Run, iterate to green** (locally — node+jsdom, no browser). The `startIngestServer` import crosses workspace to `@synapse/mcp` source; if import path is awkward, import from the built `mcp/dist` or add a thin test util. Confirm the worker POST reaches the ephemeral port (undici `fetch` in node).
- [ ] **Step 4: Commit** `test(extension): no-browser full-chain capture test (SSE→hook→relay→worker→ingest)`; push.

---

## Phase 6 — Live E2E stage + docs

### Task 6.1: Live correlation E2E (secret-gated, self-skipping)

**Files:**
- Create: `scripts/e2e-project-correlation.mjs`
- Modify: `package.json` (`test:e2e` chain) and/or `.github/workflows/ci.yml` (a gated job, mirroring `insight-roundtrip-e2e`)
- Modify: `docs/E2E-PROTOCOL.md`

- [ ] **Step 1: Stage script** (uses the `getApiKey()`/`ok()/fail()` pattern from `e2e-happy-flow.mjs`; against `SYNAPSE_API_BASE`): create two strongly-related browser-shaped conversations (`working_context:{tool:"claude-ai", projectPath:"synapse://browser/claude.ai"}`) with near-duplicate high-signal content; assert each gets a project; read `assignment_method` — **if not `ai_*` (embeddings inactive in this env), `skip()` green**; else `POST /api/internal/reconcile` with `x-synapse-internal-token` (from `INTERNAL_TRIGGER_TOKEN` env), poll, assert the two projects merged into one (real name survives). Cleanup via the `RUN_ID` pattern + `DELETE /api/projects/:id?force=true`.
- [ ] **Step 2: Wire CI** — add a `project-correlation-e2e` job mirroring `insight-roundtrip-e2e`'s gating (skip-green unless `SYNAPSE_E2E_API_KEY` present), passing `INTERNAL_TRIGGER_TOKEN`. Add to `test:e2e:all`.
- [ ] **Step 3: Docs** — in `docs/E2E-PROTOCOL.md`, replace the **manual** browser smoke with a pointer to the automated `extension/test/full-chain.test.ts` (capture path) + the live `e2e-project-correlation.mjs` (grouping/merge). Keep a one-line manual confirmation only for the literal browser-injection (world:MAIN), noting it's covered by anti-drift + spike findings.
- [ ] **Step 4: Commit** `test(e2e): live project-correlation stage + automate browser smoke`; push.

---

## Phase 7 — Verify everything green
- [ ] Local: `npm run lint && npm run typecheck && npm run test` (all workspaces) green.
- [ ] Push; watch metanmai CI until all jobs green (verify ubuntu+windows, e2e, happy-flow, insight-roundtrip, project-correlation, migrate, proxy matrix). Live stages skip-green if embeddings/secrets inactive — confirm they skip, not fail.
- [ ] Close out: update STATE/insights; supersede the design insight with a "shipped" decision.

## Self-review notes
- Spec coverage: pipeline→P3, embedding scope→P3/P4 backfill, data model→P1, reconciler→P4, thresholds/hysteresis→P2/P4, merge semantics→P2/P4, error handling→P3/P4 (null/skip), testing→P2/P3/P5/P6. ✓
- Type consistency: `assignment_method` string union, `Candidate{projectId,score}`, `ProjLite{id,name,createdAt}`, `decideAssignment` thresholds `{assign,create}` used identically across P2/P3. ✓
- Degradation everywhere: embeddings `null`→git fallback; no LLM key→reconciler skips; internal endpoint 404 when off; live stage self-skips. ✓
