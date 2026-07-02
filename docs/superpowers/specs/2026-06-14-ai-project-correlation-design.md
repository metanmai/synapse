# AI-Driven Project Correlation — Design Spec

**Date:** 2026-06-14
**Status:** Approved design (pre-plan)
**Author:** Tanmai + Claude

---

## 1. Problem & motivation

Synapse groups captured AI sessions into **projects**. Today that grouping is purely
deterministic: the backend derives a project from a capture's `working_context`
(`git_origin_url` → path basename → cwd), and auto-creates a project keyed on that
signal (`backend/src/api/conversations.ts:48`, `backend/src/db/queries/projects.ts:173`
`findOrCreateProjectByGit`).

This breaks for captures with **no git/cwd signal**:

- **Browser captures** (claude.ai, chatgpt.com) arrive tagged
  `working_context.projectPath = "synapse://browser/<host>"` with no git remote
  (`mcp/src/capture/ingest/ingest-route.ts`). The backend derives
  `git_basename = "chatgpt.com"` and files **every** ChatGPT session into a single
  project named after the host.
- **Non-code work** has no repo to key on at all.

The product vision is the opposite of host-bucketing: *"Project can start and end
anywhere and Synapse should put the pieces together on its own. The user should have
to do nothing at all."* A conversation in claude.ai about a feature should land in the
same project as the CLI coding sessions for that feature — regardless of arrival order
or source.

**Approach:** keep git as the fast deterministic path; when it is absent, let AI
semantically assign the capture to an existing project or create a new one, and let a
periodic reconciler merge fragments over time.

---

## 2. Goals & non-goals

**Goals**

1. Keyless captures get semantically assigned to the correct existing project, or a new
   project is created when confidence is too low — never orphaned, never an "unsorted"
   bucket the user must sort.
2. Cross-source grouping: browser conversations group with the CLI sessions of the same
   project.
3. Fragmented projects merge automatically over time (the host-bucket problem self-heals).
4. Zero user intervention. **Capture never blocks or fails** because of AI work.

**Non-goals (explicitly out of scope for this spec)**

- Cross-**user** correlation. Assignment is scoped to a single owner's projects
  (`owner_id` / `user_id`). Sharing across people is a separate feature.
- Auto-split / un-merge. Merges are one-way; manual `reassign` already exists if a user
  wants to correct one.
- Changing the git fast-path. Tier 1/2 behaviour is untouched.
- Real-time merges. Daily reconciliation is sufficient (decided below).
- The `entries` knowledge-base embeddings. We add embeddings to `conversations`; the
  existing `entries` vector setup is unchanged.

---

## 3. Architecture decision (locked)

**Eager assign + lazy merge** (chosen over async-only and synchronous-LLM-at-capture):

- **At capture (keyless only):** one embedding call + a cheap vector kNN decide the
  project immediately. No LLM on the hot path.
- **In the daily reconciler:** the LLM rechecks ambiguous assignments, names new
  projects, and merges fragmented projects.

Rationale: immediate grouping serves "the user does nothing," while the expensive,
latency-heavy, token-costly LLM stays entirely off the synchronous ingest path. The
embedding call fires **only** on keyless captures (a small fraction) and degrades to
today's host-bucket behaviour on failure.

### The self-healing property

A keyless capture that arrives **before** its real project's conversations are embedded
will find no neighbours → create a new project → the reconciler merges it into the real
project once backfill catches up. "Bias to create, let the merger clean up" is what lets
the system converge from *any* arrival order. This is a feature, not a compromise.

---

## 4. Resolution pipeline (capture-time)

`POST /api/conversations` with no `project_id` (the single funnel for all auto-routed
captures, CLI and browser):

```
├─ Tier 1/2  git_origin_url or real basename present
│             → findOrCreateProjectByGit              (UNCHANGED — no AI, no latency)
│
└─ Tier 3    keyless                                  → AI resolver:
                1. seed = title + first user message
                2. embedTexts([seed], "search_document", cfg)   — ONE call
                     └─ null? → FALL BACK to today's host-bucket path, done
                3. match_conversations RPC: owner-scoped cosine kNN over
                   conversations.embedding (floor = PROJECT_CREATE_THRESHOLD)
                   → rows {project_id, similarity}
                4. candidates = group rows by project_id, take max similarity per project
                5. band decision (top candidate score):
                     ≥ ASSIGN_THRESHOLD          → assign to top project   (ai_assign, store score)
                     <  CREATE_THRESHOLD / none   → create new project      (ai_create, provisional name)
                     in between (ambiguous)       → assign to top project   (ai_assign, low score → reconciler rechecks)
                6. createConversation with {project_id, embedding, assignment_method, assignment_confidence}
```

- **Keyless predicate** (when Tier 3 fires): `working_context` has no `git_origin_url`
  **and** its `projectPath` is a `synapse://` URI (or there is no `cwd`/`projectPath` at
  all). Browser captures (`synapse://browser/<host>`) match; any capture with a real git
  remote or filesystem path takes Tier 1/2 unchanged.
- **kNN floor:** the route passes `PROJECT_CREATE_THRESHOLD` as the RPC `match_threshold`,
  so a project only becomes a candidate if some conversation in it is at least
  create-worthy-similar. If the RPC returns no rows, the top score is "none" → create new.
- **Provisional name** for an `ai_create` project: the conversation `title` if present
  (claude.ai/chatgpt set titles), else placeholder `"New project"`. The reconciler
  replaces provisional names with a stable AI name (§7 step 4).
- **Quota:** the AI-create branch reuses the same `onWillCreate` hook / project-quota
  enforcement as `findOrCreateProjectByGit` — it must not bypass the free-tier project
  cap.
- **Ordering note:** the new conversation is not yet inserted at resolution time, so
  there is no self-match in the kNN. Embedding is computed in the route, used for kNN,
  then persisted by `createConversation`.

---

## 5. Embedding scope

For cross-source grouping, the kNN must compare across sources, so **every** conversation
needs an embedding — but we keep the common CLI path fast:

| Capture | When embedded | Why |
|---|---|---|
| **Keyless** (browser, non-code) | **Eagerly, at capture** | Needed to assign now |
| **Git** (CLI tools) | **Lazily, in reconciler backfill** | Already git-assigned correctly; embedding only makes it a future neighbour |

`embedTexts` is the existing client (`backend/src/lib/embeddings.ts`):
nomic-embed-text-v1.5, 768-dim, normalized, cosine, `type: "search_document"`, returns
`null` on failure (`EMBEDDING_TIMEOUT_MS = 3000`).

---

## 6. Data-model changes (migration `029`)

`supabase/migrations/029_conversation_embeddings.sql`:

1. `ALTER TABLE conversations ADD COLUMN embedding vector(768);` (nullable — conversations
   work without it).
2. `CREATE INDEX conversations_embedding_idx ON conversations USING hnsw (embedding vector_cosine_ops);`
3. `ALTER TABLE conversations ADD COLUMN assignment_method text;`
   (`git` | `ai_assign` | `ai_create` | `manual`; null = legacy/unknown).
4. `ALTER TABLE conversations ADD COLUMN assignment_confidence real;` (nullable; the kNN
   top score for AI assignments). "Needs review" is **derived**
   (`assignment_method = 'ai_assign' AND assignment_confidence < ASSIGN_THRESHOLD`), not a
   stored flag.
5. **RPC `match_conversations`** — mirrors `match_entries` (`005_pgvector.sql`) but
   **owner-scoped** instead of project-scoped:

   ```sql
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
   ```

6. **Table `project_merge_candidates`** — state for merge hysteresis:

   ```sql
   CREATE TABLE project_merge_candidates (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     project_low uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     project_high uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     score real NOT NULL,
     first_seen_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     status text NOT NULL DEFAULT 'pending',  -- pending | merged
     UNIQUE (project_low, project_high)
   );
   ```
   The pair is stored canonically ordered (`project_low` = lexicographically smaller uuid)
   so a pair is deduped regardless of detection order. RLS: follow the pattern in
   `027_rls_remaining_tables.sql` (owner-scoped).

`projects` gets **no** `updated_at` (it has none today); reconciler recency uses
conversation `updated_at`.

---

## 7. Reconciler (daily 03:00 cron)

Added as a third `ctx.waitUntil(...)` job in `scheduled()` (`backend/src/index.ts:96`),
alongside `runDailyAggregation` and `runDailyConsolidationRetry`. New module
`backend/src/cron/reconcile-projects.ts`. All steps **batched, capped, and resumable**
to fit the ~30s cron budget (eventual consistency is acceptable):

1. **Backfill embeddings** — embed up to `RECONCILE_BACKFILL_CAP` conversations where
   `embedding IS NULL` (`type: "search_document"`); write `conversations.embedding`.
2. **Recheck ambiguous** — for up to `RECONCILE_RECHECK_CAP` `ai_assign` rows with
   `assignment_confidence < ASSIGN_THRESHOLD`, one batched LLM call (conversation summary
   + candidate project names → confirm / move / split-to-new). Apply via the existing
   `reassignConversation` (`backend/src/db/queries/conversations.ts:163`).
3. **Merge detection** — for each owner (capped per run), compute a representative
   embedding per project = mean of its recent conversation embeddings (in-memory; no
   `projects.embedding` column for v1 — YAGNI). For same-owner project pairs with
   centroid similarity ≥ `MERGE_THRESHOLD`, upsert into `project_merge_candidates`
   (canonical pair order, update `score`/`last_seen_at`). **Hysteresis:** a pair is merged
   only when it qualifies in the current run **and** its candidate row already existed
   from a prior run (≥2 consecutive runs). On merge: pick canonical target (§8), call the
   existing `merge_projects(source, target, owner)` RPC (`019_merge_projects.sql`), set
   the candidate `status = 'merged'`, log to `activity_log`.
4. **Name new projects** — for `ai_create` projects still on a provisional name, one LLM
   call to generate a stable name from their conversations; store once. **Never
   regenerate** a name that is already non-provisional.

**LLM client:** reuse `AnthropicProvider.complete(prompt, maxTokens)`
(`backend/src/lib/llm/anthropic.ts`), following the `consolidateOldestInsights` pattern
(`backend/src/lib/llm/insight-consolidate.ts`: build prompt → `provider.complete` →
parse). New prompt builders go in `backend/src/lib/llm/prompts.ts`
(`buildProjectRecheckPrompt`, `buildProjectNamingPrompt`).

---

## 8. Confidence, thresholds & merge semantics

**Thresholds** — tunable constants in `backend/src/lib/constants.ts` (where
`SEMANTIC_MATCH_THRESHOLD = 0.3` already lives). Starting values, **calibrated
post-launch against real captures**:

| Constant | Value | Meaning |
|---|---|---|
| `PROJECT_ASSIGN_THRESHOLD` | `0.82` | top candidate ≥ → confident assign |
| `PROJECT_CREATE_THRESHOLD` | `0.65` | top candidate < → create new project |
| `PROJECT_MERGE_THRESHOLD` | `0.85` | project-centroid similarity to consider a merge |

nomic embeddings are normalized, so these are far stricter than the entry-search `0.3` —
appropriate for "same project" vs merely "related topic." The `[0.65, 0.82)` band is
"ambiguous": assign to the top candidate but flag for LLM recheck.

**Merge winner (locked: "real project absorbs buckets").** Given a qualifying pair, the
canonical **target** (survives; the other is the `merge_projects` source and is deleted):

1. If exactly one project is **non-synthetic**, it is the target (keep its name and
   `created_at`).
2. If both are non-synthetic, the earliest `created_at` is the target (keep its name).
3. If both are synthetic, the earliest `created_at` is the target; its name will be
   AI-generated (step 4 will see it as still-provisional).

`isSyntheticProjectName(name)` ⇔ matches `^cwd_[a-f0-9]{12}$`, OR equals a `CAPTURE_HOST`
(`@synapse/shared` — `claude.ai`, `chatgpt.com`), OR equals the `"New project"`
placeholder. This is a **pure function**, unit-tested independently.

**Hysteresis:** merges fire only after a pair is a candidate for ≥2 consecutive runs;
merges are **one-way and logged**; never auto-split.

---

## 9. Error handling & degradation

The pipeline cannot hard-fail a capture or a cron tick:

- **Embedding `null`** (timeout/down) → capture falls back to today's host/git bucket
  path; the conversation is still created. The reconciler embeds it later.
- **No LLM provider key** (e.g. metanmai CI has OpenRouter/DeepSeek but not Anthropic) →
  reconciler recheck + naming **skip and retry next run**, mirroring the existing
  consolidation cron. Assignments stay as-is.
- **LLM call failure** on an item → skip that item this run; idempotent retry next run.
- **30s cron budget** → every step is capped and resumable; partial progress is fine.
- **Idempotency** — `reassignConversation` is an idempotent no-op when already correct;
  `merge_projects` runs once per pair (candidate flips to `merged`); re-running the
  reconciler is safe.

---

## 10. Testing strategy

- **Unit (pure functions, no DB)** — following the `events-batch-pure.ts` pattern:
  - band decision (assign / ambiguous / create) over synthetic candidate scores;
  - `isSyntheticProjectName`;
  - canonical-target selection (§8 cases 1–3);
  - merge hysteresis (qualifies-once = no merge; qualifies-twice = merge);
  - candidate pair canonical ordering / dedupe.
- **Integration (real test DB, never mocks — per project rule)**:
  - `match_conversations` RPC returns owner-scoped neighbours with sane scores;
  - reconciler backfill populates embeddings;
  - reconciler merge calls `merge_projects` and consolidates conversations.
- **E2E (live merge gate, `docs/E2E-PROTOCOL.md`)**:
  - two related keyless sessions → end up grouped in one project;
  - a git session + a related browser session → reconciler (forced run) merges them;
  - embedding-service down → capture still succeeds (host-bucket fallback).

---

## 11. File map

**New**
- `supabase/migrations/029_conversation_embeddings.sql` — embedding column + HNSW index +
  `assignment_method`/`assignment_confidence` + `match_conversations` RPC +
  `project_merge_candidates` table (+ RLS).
- `backend/src/lib/project-correlation.ts` — pure decision logic (band decision,
  `isSyntheticProjectName`, canonical-target selection, hysteresis predicate).
- `backend/src/cron/reconcile-projects.ts` — the daily reconciler (4 steps).
- `backend/test/unit/project-correlation.test.ts` — pure-function unit tests.

**Modified**
- `backend/src/api/conversations.ts` — add Tier 3 AI resolver in the `if (!projectId)`
  branch (embed → kNN → band decision → create with provenance).
- `backend/src/db/queries/conversations.ts` — `createConversation` accepts
  `embedding` / `assignment_method` / `assignment_confidence`; add a kNN helper wrapping
  `match_conversations`.
- `backend/src/db/queries/projects.ts` — merge-candidate queries (upsert/select/mark);
  project-centroid query (recent conversation embeddings).
- `backend/src/index.ts` — register `reconcileProjects` in `scheduled()`.
- `backend/src/lib/constants.ts` — the three thresholds + reconciler caps.
- `backend/src/lib/llm/prompts.ts` — `buildProjectRecheckPrompt`,
  `buildProjectNamingPrompt`.

---

## 12. Open items / calibration

- **Threshold calibration:** `0.82 / 0.65 / 0.85` are informed starting points; tune
  against real capture data after launch. Ship behind the named constants so tuning is a
  one-line change.
- **Reconciler caps** — concrete starting values, raised as 30s-budget headroom is
  measured: `RECONCILE_BACKFILL_CAP = 200` (embeddings/run),
  `RECONCILE_RECHECK_CAP = 50` (LLM rechecks/run),
  `RECONCILE_OWNERS_PER_RUN = 100` (owners scanned for merge candidates/run).
- **Representative project embedding:** v1 computes centroids in-memory each run. If merge
  detection gets expensive at scale, a cached `projects.embedding` column is the obvious
  later optimization (deferred — YAGNI).
