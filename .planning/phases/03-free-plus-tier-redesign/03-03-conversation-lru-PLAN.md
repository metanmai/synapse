---
phase: 03-free-plus-tier-redesign
plan: 3
type: execute
wave: 1
depends_on: [03-01]
files_modified:
  - backend/src/db/queries/conversations.ts
  - backend/src/api/conversations.ts
  - supabase/migrations/026_conversations_cascade_messages.sql
  - backend/test/db/queries/conversations.test.ts
  - scripts/e2e-conversation-lru.mjs
autonomous: true
requirements: [TIER-03]

must_haves:
  truths:
    - "Free user's 11th conversation save into a project silently evicts the oldest conversation by updated_at"
    - "Eviction cascade-deletes the conversation's messages (FK constraint verified or added)"
    - "Plus user is NOT subject to LRU eviction (per-project cap is 50, not enforced by this slice — slice 03-04 covers Plus separately)"
    - "Reads (GET endpoints) do NOT bump updated_at — eviction LRU stays stable for actively-read but never-written conversations"
    - "E2E asserts bug class: N+K saves on Free produce exactly N rows with the OLDEST K gone"
  artifacts:
    - path: "backend/src/db/queries/conversations.ts"
      provides: "evictOldestConversationForProject + countConversationsForProject helpers"
      contains: "evictOldestConversationForProject"
    - path: "backend/src/api/conversations.ts"
      provides: "POST handler with tier-conditional pre-insert eviction"
      contains: "evictOldestConversationForProject"
    - path: "scripts/e2e-conversation-lru.mjs"
      provides: "E2E bug-class assertion for Free LRU"
      contains: "evictOldest"
  key_links:
    - from: "backend/src/api/conversations.ts"
      to: "backend/src/db/queries/conversations.ts:evictOldestConversationForProject"
      via: "import { evictOldestConversationForProject }"
      pattern: "evictOldestConversationForProject"
    - from: "backend/src/api/conversations.ts"
      to: "backend/src/lib/tier.ts:getConversationCapForTier"
      via: "import { getConversationCapForTier }"
      pattern: "getConversationCapForTier"
---

<objective>
Add silent per-project LRU eviction for conversations on the Free tier. Eviction key is `updated_at` (oldest first). Plus users are skipped here (their 50-cap is in slice 03-04). Reads must NOT bump `updated_at` — verify the existing reads don't, fix if they do.

This slice is destructive: an evicted conversation row + its messages are gone forever. Per CONTEXT.md, this is intentional and silent. No warning, no toast, no soft-delete.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md
@.planning/phases/03-free-plus-tier-redesign/03-PATTERNS.md
@backend/src/api/conversations.ts
@backend/src/db/queries/conversations.ts
@backend/src/lib/tier.ts
@supabase/migrations/
</context>

<tasks>

<task id="03-03-1" type="execute">
<title>Verify messages.conversation_id FK has ON DELETE CASCADE; add migration if not</title>
<read_first>
  - supabase/migrations/ (all migrations — search for "conversation_id" + REFERENCES + ON DELETE)
</read_first>
<action>
Search migrations for the `messages.conversation_id` FK declaration:
```bash
grep -rn "conversation_id" supabase/migrations/ | grep -iE "references|cascade|fk"
```

If the FK is declared with `ON DELETE CASCADE` (or `ON DELETE SET NULL` — unlikely for messages): NO-OP, mark task complete.

If the FK exists without ON DELETE behavior (defaults to NO ACTION/RESTRICT), CREATE migration `supabase/migrations/026_conversations_cascade_messages.sql`:

```sql
-- 026_conversations_cascade_messages.sql
-- Ensure deleting a conversation cascades to its messages.
-- Required for the Free-tier LRU eviction path (slice 03-03) — without this,
-- evicting a conversation leaves orphan messages and fails on FK constraint.

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;

ALTER TABLE messages
  ADD CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE CASCADE;
```

If unsure: TEST it. Manually run an `INSERT` + `DELETE conversations WHERE id = ...` and verify messages are gone. If the DELETE errors with FK violation: write the migration.
</action>
<acceptance_criteria>
  - Either: existing FK declaration in supabase/migrations/* includes ON DELETE CASCADE, OR migration 026_conversations_cascade_messages.sql exists
  - If migration was added: it is idempotent (DROP IF EXISTS + ADD)
  - User has applied the migration to Supabase (call out in commit message)
</acceptance_criteria>
</task>

<task id="03-03-2" type="execute">
<title>Add evictOldestConversationForProject + countConversationsForProject queries</title>
<read_first>
  - backend/src/db/queries/conversations.ts (existing query helpers — match imports and shape)
  - backend/src/db/queries/insights.ts (similar LRU pattern for inspiration — but conversations don't have supersession)
</read_first>
<action>
Edit `backend/src/db/queries/conversations.ts`. Add two helpers:

```typescript
/**
 * Count active conversations in a project. Used by the LRU eviction path
 * to decide whether to evict before insert.
 */
export async function countConversationsForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<number> {
  const { count, error } = await db
    .from("conversations")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) {
    console.error(`[db] countConversationsForProject failed: ${error.message}`);
    throw error;
  }
  return count ?? 0;
}

/**
 * Evict the oldest conversation in a project by updated_at ASC. Hard delete.
 * Messages cascade-delete via FK (verify migration 026 applied if added).
 *
 * Used by the Free-tier per-project cap. Returns the evicted ID or null if
 * the project was empty (shouldn't happen in the cap path but is safe).
 */
export async function evictOldestConversationForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data: oldest, error: selErr } = await db
    .from("conversations")
    .select("id")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: true })
    .limit(1)
    .single();
  if (selErr) {
    if (selErr.code === "PGRST116") return null;  // no rows
    console.error(`[db] evict select failed: ${selErr.message}`);
    return null;
  }
  if (!oldest) return null;

  const { error: delErr } = await db
    .from("conversations")
    .delete()
    .eq("id", oldest.id);
  if (delErr) {
    console.error(`[db] evict delete ${oldest.id} failed: ${delErr.message}`);
    return null;
  }
  return oldest.id;
}
```

Re-export both via `backend/src/db/queries/index.ts` if that's how this codebase pattern works.
</action>
<acceptance_criteria>
  - `grep -c "evictOldestConversationForProject" backend/src/db/queries/conversations.ts` returns 1
  - `grep -c "countConversationsForProject" backend/src/db/queries/conversations.ts` returns 1
  - Both helpers destructure `error` and log/throw on failure (no silent error swallow per anti-pattern guard)
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-03-3" type="execute">
<title>Tier-conditional eviction in POST /api/conversations</title>
<read_first>
  - backend/src/api/conversations.ts (existing POST handler — find where projectId is resolved and the actual create call happens)
  - backend/src/lib/tier.ts (after 03-01: getConversationCapForTier available)
</read_first>
<action>
In `backend/src/api/conversations.ts` POST handler, AFTER `projectId` is resolved (whether passed or auto-created via findOrCreateProjectByGit) and BEFORE the actual `createConversation` call:

```typescript
import { getConversationCapForTier, type Tier } from "../lib/tier";
import { countConversationsForProject, evictOldestConversationForProject } from "../db/queries/conversations";

// ... inside POST handler, after projectId is final:
const tier = (c.get("tier") ?? "free") as Tier;
if (tier === "free") {
  const cap = getConversationCapForTier(tier);
  const count = await countConversationsForProject(db, projectId);
  if (count >= cap) {
    // Silent LRU eviction per CONTEXT.md
    await evictOldestConversationForProject(db, projectId);
  }
}
// ... continue to existing createConversation call
```

Do NOT log the eviction at info-level — silent per spec. Internal warn-level for debugging is OK.
</action>
<acceptance_criteria>
  - `grep -c "evictOldestConversationForProject" backend/src/api/conversations.ts` returns 1
  - `grep -c "getConversationCapForTier" backend/src/api/conversations.ts` returns 1
  - The eviction call is gated by `tier === "free"`
  - The eviction happens BEFORE the create (not after — order matters: cap is N stored at any time)
  - `npm run typecheck --workspace=backend` exits 0
</acceptance_criteria>
</task>

<task id="03-03-4" type="execute">
<title>Verify reads don't bump updated_at</title>
<read_first>
  - backend/src/api/conversations.ts (GET endpoints)
  - backend/src/db/queries/conversations.ts (read helpers like getConversation, listConversations, getMessages)
  - supabase/migrations/023_conversations_updated_at_trigger.sql (if a trigger updates this column)
</read_first>
<action>
Walk through each GET path for conversations. For each, confirm none of them UPDATE the conversation row.

Specifically check:
1. `GET /api/conversations/:id` — should only SELECT, never UPDATE.
2. `GET /api/projects/:id/conversations` — same.
3. `GET /api/conversations/:id/messages` — same; only SELECTs messages.
4. Any trigger on `conversations` table that bumps `updated_at` (`023_conversations_updated_at_trigger.sql` — read it; if it fires only on UPDATE, fine; if it fires on SELECT somehow, that's broken but unlikely).

If any read path is found to bump `updated_at`: surface the bug and fix it. If `appendMessages` (writes a message into an existing conversation) bumps `updated_at`, that's CORRECT — that's a write.

NO CODE CHANGE if everything is already correct. The acceptance is: documented audit results.
</action>
<acceptance_criteria>
  - All GET endpoints on conversations verified to not write back to the row (audit comment in commit message)
  - `appendMessages` confirmed to bump `updated_at` (correct — that IS a write that should reset LRU position)
  - Trigger `023_conversations_updated_at_trigger.sql` confirmed to fire only on UPDATE
</acceptance_criteria>
</task>

<task id="03-03-5" type="execute">
<title>Unit tests for evictOldestConversationForProject</title>
<read_first>
  - backend/test/db/queries/conversations.test.ts (existing test shape — vitest, mock supabase client)
</read_first>
<action>
Add tests to `backend/test/db/queries/conversations.test.ts`:

```typescript
describe("evictOldestConversationForProject", () => {
  it("deletes the oldest conversation by updated_at and returns its id", async () => {
    // Setup mock supabase that returns a row with id "old-conv-id" from the select,
    // and a successful delete.
    // ... mock chain
    const result = await evictOldestConversationForProject(db, "proj-1");
    expect(result).toBe("old-conv-id");
  });

  it("returns null when the project has no conversations", async () => {
    // Setup mock that returns PGRST116 (no rows)
    const result = await evictOldestConversationForProject(db, "proj-empty");
    expect(result).toBeNull();
  });

  it("returns null when delete fails (does not throw)", async () => {
    // Setup mock that succeeds on select but errors on delete
    const result = await evictOldestConversationForProject(db, "proj-broken");
    expect(result).toBeNull();
    // Assert the error was logged (vi.spyOn(console, "error"))
  });
});

describe("countConversationsForProject", () => {
  it("returns the count for a project", async () => {
    // ... mock returning count: 7
    expect(await countConversationsForProject(db, "proj-1")).toBe(7);
  });
  it("returns 0 when the project is empty", async () => {
    expect(await countConversationsForProject(db, "proj-empty")).toBe(0);
  });
});
```

Use existing mock patterns from other tests in the file. Match the imports.
</action>
<acceptance_criteria>
  - `npm run test --workspace=backend -- conversations` exits 0
  - All 5 new test cases pass
  - Tests guard the bug class (returns null on missing/error, deletes oldest, counts correctly) — not specific row IDs
</acceptance_criteria>
</task>

<task id="03-03-6" type="execute">
<title>E2E test asserting LRU bug class on Free</title>
<read_first>
  - scripts/e2e-smoke.mjs (existing E2E shape)
</read_first>
<action>
Create `scripts/e2e-conversation-lru.mjs`:

1. Use a Free-tier E2E user account (env `SYNAPSE_E2E_FREE_API_KEY`).
2. PRECONDITION: pick a test project (or create one).
3. PHASE 1 (cleanup): delete all conversations in the test project (POST /api/projects/<id>/conversations/clear or per-conv DELETE).
4. PHASE 2 (saturate): create 10 conversations named `e2e-conv-${i}`, recording IDs in order created.
5. PHASE 3 (assert at cap): list conversations — should be exactly 10.
6. PHASE 4 (eviction): create the 11th. List — should still be 10. The ORIGINAL FIRST conversation (e2e-conv-1, oldest updated_at) should be GONE. e2e-conv-2 through e2e-conv-11 should all be present.
7. PHASE 5 (cascade): the messages of e2e-conv-1 (if any were inserted) should also be gone — query messages by conversation_id, expect 0.
8. PHASE 6 (still LRU after re-touch): touch (POST a message to) e2e-conv-2 (now the oldest). Then create e2e-conv-12. Assert e2e-conv-3 is gone, e2e-conv-2 survives (it became newer after the touch).
9. PHASE 7 (cleanup): delete all 10 remaining test convs.

Exit 0 on all pass, 1 on any phase fail. Print per-phase OK/FAIL.

THIS GUARDS THE BUG CLASS — eviction-by-updated-at-ASC, write-bumps-updated-at — not a specific ID.
</action>
<acceptance_criteria>
  - File `scripts/e2e-conversation-lru.mjs` exists
  - Running it with valid Free API key exits 0
  - All 7 phases print PASS
  - Self-cleaning: no `e2e-conv-*` remain on the account after run
</acceptance_criteria>
</task>

</tasks>

<verification>
1. `npm run lint && npm run typecheck && npm run test` all exit 0
2. `node scripts/e2e-conversation-lru.mjs` passes
3. Manual: in a fresh Free account, POST 11 conversations via curl + verify the 1st is gone
4. Migration 026 (if added) applied to Supabase production
</verification>
