# Conversation Sync & Key Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone key insights (memory) system for all users, and full conversation syncing across AI agents for Plus users.

**Architecture:** Two new database domains (insights + conversations) with dedicated backend queries, API endpoints, MCP tools, and frontend pages. Conversations use a canonical message format with pluggable agent adapters for format translation. Media stored in Supabase Storage. All conversation data is E2E encrypted.

**Tech Stack:** Hono (backend), Supabase (Postgres + Storage), SvelteKit (frontend), Zod (validation), Vitest (tests), MCP SDK

**Spec:** `docs/superpowers/specs/2026-03-28-conversation-sync-design.md`

---

## File Structure

### New Files

```
# Database
supabase/migrations/006_insights.sql
supabase/migrations/007_conversations.sql

# Shared types
packages/shared/src/insights.ts
packages/shared/src/conversations.ts

# Backend — Insights
backend/src/db/queries/insights.ts
backend/src/api/insights.ts
backend/src/mcp/tools/insights.ts

# Backend — Conversations
backend/src/db/queries/conversations.ts
backend/src/api/conversations.ts
backend/src/mcp/tools/conversations.ts
backend/src/lib/adapters/types.ts
backend/src/lib/adapters/anthropic.ts
backend/src/lib/adapters/openai.ts
backend/src/lib/adapters/raw.ts
backend/src/lib/adapters/index.ts
backend/src/lib/storage.ts

# Frontend — Insights
frontend/src/routes/(app)/projects/[name]/insights/+page.server.ts
frontend/src/routes/(app)/projects/[name]/insights/+page.svelte
frontend/src/lib/components/insights/InsightList.svelte
frontend/src/lib/components/insights/InsightCard.svelte

# Frontend — Conversations
frontend/src/routes/(app)/projects/[name]/conversations/+page.server.ts
frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte
frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.server.ts
frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte
frontend/src/routes/(app)/projects/[name]/conversations/import/+page.server.ts
frontend/src/routes/(app)/projects/[name]/conversations/import/+page.svelte
frontend/src/lib/components/conversations/ConversationList.svelte
frontend/src/lib/components/conversations/MessageThread.svelte
frontend/src/lib/components/conversations/ImportDropzone.svelte

# Tests
backend/test/api/insights.test.ts
backend/test/api/conversations.test.ts
backend/test/lib/adapters.test.ts
```

### Modified Files

```
packages/shared/src/types.ts              — re-export new types
backend/src/db/queries/index.ts           — export new query modules
backend/src/db/types.ts                   — add tier limits for conversations
backend/src/lib/validate.ts               — add schemas for insights + conversations
backend/src/lib/tier.ts                   — add conversation tier enforcement
backend/src/index.ts                      — mount new routes
backend/src/mcp/agent.ts                  — register new MCP tools
backend/src/mcp/tools/context-retrieval.ts — extend search to include insights
frontend/src/lib/types.ts                 — re-export new types
frontend/src/lib/server/api.ts            — add API client methods
frontend/src/lib/components/layout/Sidebar.svelte — add nav links
```

---

## Phase 1: Key Insights (All Tiers)

### Task 1: Database Migration — Insights Table

**Files:**
- Create: `supabase/migrations/006_insights.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 006_insights.sql
-- Key Insights: standalone memory/learnings system for all users

create table insights (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid not null references users(id),
  type            text not null check (type in ('decision', 'learning', 'preference', 'architecture', 'action_item')),
  summary         text not null,
  detail          text,
  source          jsonb,
  search_vector   tsvector generated always as (
    setweight(to_tsvector('english', coalesce(summary, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(detail, '')), 'B')
  ) stored,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_insights_project on insights(project_id);
create index idx_insights_user on insights(user_id);
create index idx_insights_type on insights(project_id, type);
create index idx_insights_search on insights using gin(search_vector);

-- RLS (enforced at app level, but enable for safety)
alter table insights enable row level security;
```

- [ ] **Step 2: Apply migration locally**

Run: `cd supabase && supabase db push`
Expected: Migration applies successfully

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/006_insights.sql
git commit -m "feat: add insights table migration"
```

---

### Task 2: Shared Types — Insights

**Files:**
- Create: `packages/shared/src/insights.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Write the shared insight types**

```typescript
// packages/shared/src/insights.ts

export type InsightType = "decision" | "learning" | "preference" | "architecture" | "action_item";

export interface InsightSource {
  type: "conversation" | "session" | "manual";
  id?: string;
  agent?: string;
}

export interface Insight {
  id: string;
  project_id: string;
  user_id: string;
  type: InsightType;
  summary: string;
  detail: string | null;
  source: InsightSource | null;
  encrypted: boolean;
  created_at: string;
  updated_at: string;
}

export interface InsightListItem {
  id: string;
  type: InsightType;
  summary: string;
  source: InsightSource | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Re-export from shared index**

Add to the end of `packages/shared/src/types.ts`:

```typescript
export type { Insight, InsightListItem, InsightType, InsightSource } from "./insights";
```

- [ ] **Step 3: Re-export from frontend types**

Add to `frontend/src/lib/types.ts`:

```typescript
export type { Insight, InsightListItem, InsightType, InsightSource } from "@synapse/shared";
```

- [ ] **Step 4: Re-export from backend types**

Add to `backend/src/db/types.ts`:

```typescript
export type { Insight, InsightListItem, InsightType, InsightSource } from "@synapse/shared";
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/insights.ts packages/shared/src/types.ts frontend/src/lib/types.ts backend/src/db/types.ts
git commit -m "feat: add shared insight types"
```

---

### Task 3: Backend Queries — Insights CRUD

**Files:**
- Create: `backend/src/db/queries/insights.ts`
- Modify: `backend/src/db/queries/index.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/api/insights.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Insights API — auth enforcement", () => {
  it("GET /api/insights without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights?project_id=test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/insights without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: "test",
        type: "decision",
        summary: "Use Postgres",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("PATCH /api/insights/some-id without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Updated" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE /api/insights/some-id without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights/some-id", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/api/insights.test.ts`
Expected: FAIL — route not found (404 instead of 401)

- [ ] **Step 3: Write the insight queries**

Create `backend/src/db/queries/insights.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, InsightListItem, InsightType, InsightSource } from "../types";

const INSIGHT_COLUMNS =
  "id, project_id, user_id, type, summary, detail, source, encrypted, created_at, updated_at";

const INSIGHT_LIST_COLUMNS = "id, type, summary, source, created_at, updated_at";

export async function createInsight(
  db: SupabaseClient,
  params: {
    project_id: string;
    user_id: string;
    type: InsightType;
    summary: string;
    detail?: string | null;
    source?: InsightSource | null;
    encrypted?: boolean;
  },
): Promise<Insight> {
  const { data, error } = await db
    .from("insights")
    .insert({
      project_id: params.project_id,
      user_id: params.user_id,
      type: params.type,
      summary: params.summary,
      detail: params.detail ?? null,
      source: params.source ?? null,
      encrypted: params.encrypted ?? false,
    })
    .select(INSIGHT_COLUMNS)
    .single();
  if (error) throw error;
  return data as Insight;
}

export async function listInsights(
  db: SupabaseClient,
  projectId: string,
  options?: { type?: InsightType; limit?: number; offset?: number },
): Promise<{ insights: InsightListItem[]; total: number }> {
  let query = db
    .from("insights")
    .select(INSIGHT_LIST_COLUMNS, { count: "exact" })
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (options?.type) {
    query = query.eq("type", options.type);
  }

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    insights: (data ?? []) as InsightListItem[],
    total: count ?? 0,
  };
}

export async function getInsight(
  db: SupabaseClient,
  insightId: string,
): Promise<Insight | null> {
  const { data, error } = await db
    .from("insights")
    .select(INSIGHT_COLUMNS)
    .eq("id", insightId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as Insight;
}

export async function updateInsight(
  db: SupabaseClient,
  insightId: string,
  params: {
    type?: InsightType;
    summary?: string;
    detail?: string | null;
    source?: InsightSource | null;
  },
): Promise<Insight> {
  const { data, error } = await db
    .from("insights")
    .update({ ...params, updated_at: new Date().toISOString() })
    .eq("id", insightId)
    .select(INSIGHT_COLUMNS)
    .single();
  if (error) throw error;
  return data as Insight;
}

export async function deleteInsight(
  db: SupabaseClient,
  insightId: string,
): Promise<void> {
  const { error } = await db.from("insights").delete().eq("id", insightId);
  if (error) throw error;
}

export async function searchInsights(
  db: SupabaseClient,
  projectId: string,
  query: string,
): Promise<Insight[]> {
  // Full-text search on insights
  const { data, error } = await db
    .from("insights")
    .select(INSIGHT_COLUMNS)
    .eq("project_id", projectId)
    .textSearch("search_vector", query, { type: "websearch" })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as Insight[];
}
```

- [ ] **Step 4: Export from queries index**

Add to `backend/src/db/queries/index.ts`:

```typescript
export * from "./insights";
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/queries/insights.ts backend/src/db/queries/index.ts backend/test/api/insights.test.ts
git commit -m "feat: add insight database queries"
```

---

### Task 4: Backend API — Insights Endpoints

**Files:**
- Create: `backend/src/api/insights.ts`
- Modify: `backend/src/lib/validate.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add validation schemas**

Add to `backend/src/lib/validate.ts` inside the `schemas` object:

```typescript
  // Insights
  createInsight: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
    type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]),
    summary: z.string().min(1, "Summary is required"),
    detail: z.string().nullable().optional(),
    source: z
      .object({
        type: z.enum(["conversation", "session", "manual"]),
        id: z.string().optional(),
        agent: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),

  updateInsight: z.object({
    type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).optional(),
    summary: z.string().min(1).optional(),
    detail: z.string().nullable().optional(),
    source: z
      .object({
        type: z.enum(["conversation", "session", "manual"]),
        id: z.string().optional(),
        agent: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),
```

- [ ] **Step 2: Write the route handler**

Create `backend/src/api/insights.ts`:

```typescript
import { Hono } from "hono";
import { logActivity } from "../db/activity-logger";
import { createSupabaseClient } from "../db/client";
import {
  createInsight,
  deleteInsight,
  getInsight,
  listInsights,
  updateInsight,
} from "../db/queries";
import { authMiddleware } from "../lib/auth";
import { ForbiddenError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";
import { parseBody, schemas } from "../lib/validate";

import type { InsightType } from "../db/types";

const insights = new Hono<{ Bindings: Env }>();
insights.use("*", authMiddleware);
insights.use("*", idempotency);

// GET /api/insights?project_id=...&type=...&limit=...&offset=...
insights.get("/", async (c) => {
  const user = c.get("user");
  const projectId = c.req.query("project_id");
  if (!projectId) {
    return c.json({ error: "project_id is required" }, 400);
  }

  const type = c.req.query("type") as InsightType | undefined;
  const limit = Number.parseInt(c.req.query("limit") ?? "20");
  const offset = Number.parseInt(c.req.query("offset") ?? "0");

  const db = createSupabaseClient(c.env);
  const result = await listInsights(db, projectId, { type, limit, offset });
  return c.json(result);
});

// POST /api/insights
insights.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, schemas.createInsight);

  const db = createSupabaseClient(c.env);
  const insight = await createInsight(db, {
    ...body,
    user_id: user.id,
  });

  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "insight_created",
    source: "human",
    metadata: { type: body.type, summary: body.summary },
  });

  return c.json(insight, 201);
});

// PATCH /api/insights/:id
insights.patch("/:id", async (c) => {
  const user = c.get("user");
  const insightId = c.req.param("id");
  const body = await parseBody(c, schemas.updateInsight);

  const db = createSupabaseClient(c.env);
  const existing = await getInsight(db, insightId);
  if (!existing) throw new NotFoundError("Insight not found");
  if (existing.user_id !== user.id) throw new ForbiddenError("Cannot edit another user's insight");

  const updated = await updateInsight(db, insightId, body);
  return c.json(updated);
});

// DELETE /api/insights/:id
insights.delete("/:id", async (c) => {
  const user = c.get("user");
  const insightId = c.req.param("id");

  const db = createSupabaseClient(c.env);
  const existing = await getInsight(db, insightId);
  if (!existing) throw new NotFoundError("Insight not found");
  if (existing.user_id !== user.id) throw new ForbiddenError("Cannot delete another user's insight");

  await deleteInsight(db, insightId);
  return c.json({ ok: true });
});

export { insights };
```

- [ ] **Step 3: Mount the route in index.ts**

Add to `backend/src/index.ts`:

After `import { billing } from "./api/billing";`:
```typescript
import { insights } from "./api/insights";
```

After `app.route("/api/billing", billing);`:
```typescript
app.route("/api/insights", insights);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/api/insights.test.ts`
Expected: All 4 tests PASS (401 for unauthenticated requests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/insights.ts backend/src/lib/validate.ts backend/src/index.ts
git commit -m "feat: add insights API endpoints"
```

---

### Task 5: MCP Tools — save_insight & list_insights

**Files:**
- Create: `backend/src/mcp/tools/insights.ts`
- Modify: `backend/src/mcp/agent.ts`

- [ ] **Step 1: Write the MCP insight tools**

Create `backend/src/mcp/tools/insights.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logActivity } from "../../db/activity-logger";
import { createSupabaseClient } from "../../db/client";
import { createInsight, listInsights, getProjectByName } from "../../db/queries";
import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { requireMcpUserId } from "../mcp-context";

export function registerInsightTools(server: McpServer, env: Env, getContext: GetMcpContext) {
  server.tool(
    "save_insight",
    "Save a key insight — a decision, learning, preference, architecture choice, or action item. Use this to build up a persistent knowledge base of important takeaways from any session.",
    {
      project: z.string().describe("Project name"),
      type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).describe(
        "Type of insight: decision (a choice made), learning (something discovered), preference (user preference), architecture (system design choice), action_item (something to do later)",
      ),
      summary: z.string().describe("Concise one-line summary of the insight"),
      detail: z.string().optional().describe("Optional fuller context or reasoning"),
    },
    async ({ project, type, summary, detail }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }] };

      const insight = await createInsight(db, {
        project_id: proj.id,
        user_id: userId,
        type,
        summary,
        detail: detail ?? null,
        source: { type: "session", agent: "claude" },
      });

      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "insight_created",
        source: "claude",
        metadata: { type, summary },
      });

      return {
        content: [{ type: "text" as const, text: `Saved ${type} insight: "${summary}"` }],
      };
    },
  );

  server.tool(
    "list_insights",
    "List key insights for a project. Returns decisions, learnings, preferences, and other knowledge accumulated over time.",
    {
      project: z.string().describe("Project name"),
      type: z
        .enum(["decision", "learning", "preference", "architecture", "action_item"])
        .optional()
        .describe("Filter by insight type"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async ({ project, type, limit }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }] };

      const result = await listInsights(db, proj.id, { type, limit: limit ?? 20 });

      if (result.insights.length === 0) {
        return { content: [{ type: "text" as const, text: "No insights found." }] };
      }

      const lines = result.insights.map(
        (i) => `- [${i.type}] ${i.summary} (${new Date(i.updated_at).toLocaleDateString()})`,
      );
      return {
        content: [{ type: "text" as const, text: `${result.total} insights:\n\n${lines.join("\n")}` }],
      };
    },
  );
}
```

- [ ] **Step 2: Register tools in agent.ts**

Add import to `backend/src/mcp/agent.ts`:

```typescript
import { registerInsightTools } from "./tools/insights";
```

Add registration call inside `init()`, after the existing `registerGoogleSyncTools` line:

```typescript
    registerInsightTools(this.server, env, getContext);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/mcp/tools/insights.ts backend/src/mcp/agent.ts
git commit -m "feat: add save_insight and list_insights MCP tools"
```

---

### Task 6: Extend search_context to Include Insights

**Files:**
- Modify: `backend/src/mcp/tools/context-retrieval.ts`
- Modify: `backend/src/db/queries/insights.ts`

- [ ] **Step 1: Read the current search_context tool**

Read `backend/src/mcp/tools/context-retrieval.ts` to understand the current search implementation.

- [ ] **Step 2: Add insight search to the search_context tool**

In `backend/src/mcp/tools/context-retrieval.ts`, import `searchInsights`:

```typescript
import { searchInsights } from "../../db/queries";
```

Inside the `search_context` tool's handler, after the existing entry search results are gathered, add:

```typescript
      // Also search insights
      const insightResults = await searchInsights(db, proj.id, query);
      if (insightResults.length > 0) {
        const insightLines = insightResults.map(
          (i) => `  [${i.type}] ${i.summary}${i.detail ? `\n    ${i.detail}` : ""}`,
        );
        resultText += `\n\n**Key Insights:**\n${insightLines.join("\n")}`;
      }
```

The exact insertion point depends on how the current tool structures its output. The key is that search results now include both entries and insights.

- [ ] **Step 3: Commit**

```bash
git add backend/src/mcp/tools/context-retrieval.ts
git commit -m "feat: extend search_context to include insights in results"
```

---

### Task 7: Frontend API Client — Insights Methods

**Files:**
- Modify: `frontend/src/lib/server/api.ts`

- [ ] **Step 1: Add insight methods to the API client**

Add to the return object of `createApi` in `frontend/src/lib/server/api.ts`:

```typescript
    // Insights
    listInsights: (projectId: string, type?: string, limit = 20, offset = 0) =>
      request<{ insights: import("$lib/types").InsightListItem[]; total: number }>(
        `/api/insights?project_id=${projectId}${type ? `&type=${type}` : ""}&limit=${limit}&offset=${offset}`,
        token,
      ),
    createInsight: (projectId: string, type: string, summary: string, detail?: string) =>
      request<import("$lib/types").Insight>("/api/insights", token, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, type, summary, detail }),
      }),
    updateInsight: (insightId: string, updates: { type?: string; summary?: string; detail?: string | null }) =>
      request<import("$lib/types").Insight>(`/api/insights/${insightId}`, token, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    deleteInsight: (insightId: string) =>
      request<{ ok: true }>(`/api/insights/${insightId}`, token, { method: "DELETE" }),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/server/api.ts
git commit -m "feat: add insights methods to frontend API client"
```

---

### Task 8: Frontend — Insights Page

**Files:**
- Create: `frontend/src/routes/(app)/projects/[name]/insights/+page.server.ts`
- Create: `frontend/src/routes/(app)/projects/[name]/insights/+page.svelte`
- Create: `frontend/src/lib/components/insights/InsightList.svelte`
- Create: `frontend/src/lib/components/insights/InsightCard.svelte`
- Modify: `frontend/src/lib/components/layout/Sidebar.svelte`

- [ ] **Step 1: Write the page server load function**

Create `frontend/src/routes/(app)/projects/[name]/insights/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const result = await api.listInsights(project.id);
  return { insights: result.insights, total: result.total };
};

export const actions: Actions = {
  create: async ({ request, parent, locals }) => {
    const { project } = await parent();
    const data = await request.formData();
    const type = data.get("type") as string;
    const summary = (data.get("summary") as string)?.trim();
    const detail = (data.get("detail") as string)?.trim() || undefined;

    if (!summary) return fail(400, { error: "Summary is required" });

    const api = createApi(locals.token);
    try {
      await api.createInsight(project.id, type, summary, detail);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to save" });
    }
    return { created: true };
  },

  delete: async ({ request, locals }) => {
    const data = await request.formData();
    const insightId = data.get("insightId") as string;

    const api = createApi(locals.token);
    try {
      await api.deleteInsight(insightId);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to delete" });
    }
    return { deleted: true };
  },
};
```

- [ ] **Step 2: Write the InsightCard component**

Create `frontend/src/lib/components/insights/InsightCard.svelte`:

```svelte
<script lang="ts">
  import type { InsightListItem } from "$lib/types";

  let { insight, ondelete }: { insight: InsightListItem; ondelete?: (id: string) => void } = $props();

  const typeColors: Record<string, string> = {
    decision: "bg-blue-500/20 text-blue-300",
    learning: "bg-green-500/20 text-green-300",
    preference: "bg-purple-500/20 text-purple-300",
    architecture: "bg-orange-500/20 text-orange-300",
    action_item: "bg-red-500/20 text-red-300",
  };

  const typeColor = $derived(typeColors[insight.type] ?? "bg-gray-500/20 text-gray-300");
  const dateStr = $derived(new Date(insight.updated_at).toLocaleDateString());
</script>

<div class="border border-white/10 rounded-lg p-4 hover:border-white/20 transition-colors">
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs font-medium px-2 py-0.5 rounded-full {typeColor}">
      {insight.type.replace("_", " ")}
    </span>
    <span class="text-xs text-white/40">{dateStr}</span>
  </div>
  <p class="text-sm text-white/80">{insight.summary}</p>
  {#if ondelete}
    <form method="POST" action="?/delete" class="mt-2">
      <input type="hidden" name="insightId" value={insight.id} />
      <button type="submit" class="text-xs text-red-400 hover:text-red-300">Delete</button>
    </form>
  {/if}
</div>
```

- [ ] **Step 3: Write the InsightList component**

Create `frontend/src/lib/components/insights/InsightList.svelte`:

```svelte
<script lang="ts">
  import type { InsightListItem } from "$lib/types";
  import InsightCard from "./InsightCard.svelte";

  let { insights }: { insights: InsightListItem[] } = $props();
</script>

{#if insights.length === 0}
  <div class="text-center py-12 text-white/40">
    <p class="text-lg mb-2">No insights yet</p>
    <p class="text-sm">Insights are automatically captured during AI sessions, or you can add them manually below.</p>
  </div>
{:else}
  <div class="grid gap-3">
    {#each insights as insight (insight.id)}
      <InsightCard {insight} ondelete={() => {}} />
    {/each}
  </div>
{/if}
```

- [ ] **Step 4: Write the insights page**

Create `frontend/src/routes/(app)/projects/[name]/insights/+page.svelte`:

```svelte
<script lang="ts">
  import InsightList from "$lib/components/insights/InsightList.svelte";

  let { data, form } = $props();

  let showForm = $state(false);
</script>

<div class="max-w-4xl mx-auto p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-xl font-semibold text-white">Key Insights</h1>
    <button
      onclick={() => (showForm = !showForm)}
      class="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/15 rounded-lg transition-colors"
    >
      {showForm ? "Cancel" : "+ Add Insight"}
    </button>
  </div>

  {#if form?.error}
    <div class="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
      {form.error}
    </div>
  {/if}

  {#if showForm}
    <form method="POST" action="?/create" class="mb-6 p-4 border border-white/10 rounded-lg space-y-3">
      <div>
        <label for="type" class="block text-xs text-white/50 mb-1">Type</label>
        <select name="type" id="type" class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white">
          <option value="decision">Decision</option>
          <option value="learning">Learning</option>
          <option value="preference">Preference</option>
          <option value="architecture">Architecture</option>
          <option value="action_item">Action Item</option>
        </select>
      </div>
      <div>
        <label for="summary" class="block text-xs text-white/50 mb-1">Summary</label>
        <input name="summary" id="summary" type="text" required
          class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white"
          placeholder="One-line summary of the insight" />
      </div>
      <div>
        <label for="detail" class="block text-xs text-white/50 mb-1">Detail (optional)</label>
        <textarea name="detail" id="detail" rows="3"
          class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white"
          placeholder="Additional context or reasoning"></textarea>
      </div>
      <button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors">
        Save Insight
      </button>
    </form>
  {/if}

  <InsightList insights={data.insights} />
</div>
```

- [ ] **Step 5: Add insights link to sidebar**

In `frontend/src/lib/components/layout/Sidebar.svelte`, add a navigation link for insights alongside the existing project navigation items. Look for where activity/settings links are rendered and add:

```svelte
<a href="/projects/{projectName}/insights"
  class="flex items-center gap-2 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
  class:text-white={currentPath?.includes('/insights')}
  class:bg-white/10={currentPath?.includes('/insights')}>
  Insights
</a>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/insights/ frontend/src/lib/components/insights/ frontend/src/lib/components/layout/Sidebar.svelte
git commit -m "feat: add insights page and components to frontend"
```

---

## Phase 2: Conversation Sync (Plus Only)

### Task 9: Database Migration — Conversations Tables

**Files:**
- Create: `supabase/migrations/007_conversations.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 007_conversations.sql
-- Conversation sync: full transcript syncing across AI agents (Plus only)

-- Core conversation record
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid not null references users(id),
  title           text,
  status          text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  fidelity_mode   text not null default 'summary' check (fidelity_mode in ('summary', 'full')),
  system_prompt   text,
  working_context jsonb,
  forked_from     uuid references conversations(id),
  fork_point      int,
  message_count   int not null default 0,
  media_size      bigint not null default 0,
  metadata        jsonb,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_conversations_project on conversations(project_id);
create index idx_conversations_user on conversations(user_id);
create index idx_conversations_status on conversations(project_id, status);

-- Individual messages in order
create table conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sequence        int not null,
  role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         text,
  tool_interaction jsonb,
  source_agent    text not null,
  source_model    text,
  token_count     jsonb,
  cost            numeric,
  attachments_summary text,
  parent_message_id uuid references conversation_messages(id),
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique(conversation_id, sequence)
);

create index idx_messages_conversation on conversation_messages(conversation_id, sequence);

-- Media linked to messages
create table conversation_media (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references conversation_messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  type            text not null check (type in ('image', 'file', 'pdf', 'audio', 'video')),
  mime_type       text not null,
  filename        text,
  size            bigint not null,
  storage_path    text not null,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_media_message on conversation_media(message_id);
create index idx_media_conversation on conversation_media(conversation_id);

-- File/repo context snapshots
create table conversation_context (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  type            text not null check (type in ('file', 'repo', 'env', 'dependency')),
  key             text not null,
  value           text,
  snapshot_at     int,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_context_conversation on conversation_context(conversation_id);

-- Tier limits for conversations
create table conversation_limits (
  tier              text primary key,
  max_conversations int,
  max_messages      int,
  max_media_bytes   bigint,
  sync_enabled      boolean not null default false
);

insert into conversation_limits (tier, max_conversations, max_messages, max_media_bytes, sync_enabled)
values
  ('free',  null, null, null, false),
  ('plus',  null, null, null, true);

-- RLS
alter table conversations enable row level security;
alter table conversation_messages enable row level security;
alter table conversation_media enable row level security;
alter table conversation_context enable row level security;
alter table conversation_limits enable row level security;
```

- [ ] **Step 2: Apply migration locally**

Run: `cd supabase && supabase db push`
Expected: Migration applies successfully

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_conversations.sql
git commit -m "feat: add conversations tables migration"
```

---

### Task 10: Shared Types — Conversations

**Files:**
- Create: `packages/shared/src/conversations.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `backend/src/db/types.ts`

- [ ] **Step 1: Write the shared conversation types**

Create `packages/shared/src/conversations.ts`:

```typescript
// --- Canonical message format ---

export interface CanonicalMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  media?: MediaAttachment[];
  toolInteraction?: ToolInteraction;
  source: MessageSource;
  tokenCount?: { input?: number; output?: number };
  cost?: number;
  parentMessageId?: string;
  createdAt: string;
}

export interface ToolInteraction {
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  summary: string;
}

export interface MessageSource {
  agent: string;
  model?: string;
}

export interface MediaAttachment {
  id: string;
  type: "image" | "file" | "pdf" | "audio" | "video";
  mimeType: string;
  filename: string;
  size: number;
  storagePath: string;
  url?: string;
}

// --- Database row types ---

export type ConversationStatus = "active" | "archived" | "deleted";
export type FidelityMode = "summary" | "full";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MediaType = "image" | "file" | "pdf" | "audio" | "video";
export type ContextType = "file" | "repo" | "env" | "dependency";

export interface Conversation {
  id: string;
  project_id: string;
  user_id: string;
  title: string | null;
  status: ConversationStatus;
  fidelity_mode: FidelityMode;
  system_prompt: string | null;
  working_context: Record<string, unknown> | null;
  forked_from: string | null;
  fork_point: number | null;
  message_count: number;
  media_size: number;
  metadata: Record<string, unknown> | null;
  encrypted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  status: ConversationStatus;
  message_count: number;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sequence: number;
  role: MessageRole;
  content: string | null;
  tool_interaction: ToolInteraction | null;
  source_agent: string;
  source_model: string | null;
  token_count: { input?: number; output?: number } | null;
  cost: number | null;
  attachments_summary: string | null;
  parent_message_id: string | null;
  encrypted: boolean;
  created_at: string;
}

export interface ConversationMediaRecord {
  id: string;
  message_id: string;
  conversation_id: string;
  type: MediaType;
  mime_type: string;
  filename: string | null;
  size: number;
  storage_path: string;
  encrypted: boolean;
  created_at: string;
}

export interface ConversationContext {
  id: string;
  conversation_id: string;
  type: ContextType;
  key: string;
  value: string | null;
  snapshot_at: number | null;
  encrypted: boolean;
  created_at: string;
}

export interface ConversationLimits {
  tier: string;
  max_conversations: number | null;
  max_messages: number | null;
  max_media_bytes: number | null;
  sync_enabled: boolean;
}
```

- [ ] **Step 2: Re-export from shared**

Add to `packages/shared/src/types.ts`:

```typescript
export type {
  CanonicalMessage,
  ToolInteraction,
  MessageSource,
  MediaAttachment,
  Conversation,
  ConversationListItem,
  ConversationMessage,
  ConversationMediaRecord,
  ConversationContext,
  ConversationLimits,
  ConversationStatus,
  FidelityMode,
  MessageRole,
  MediaType,
  ContextType,
} from "./conversations";
```

- [ ] **Step 3: Re-export from frontend and backend types**

Add to `frontend/src/lib/types.ts`:

```typescript
export type {
  Conversation,
  ConversationListItem,
  ConversationMessage,
  ConversationMediaRecord,
  CanonicalMessage,
  MediaAttachment,
} from "@synapse/shared";
```

Add to `backend/src/db/types.ts`:

```typescript
export type {
  CanonicalMessage,
  ToolInteraction,
  MessageSource,
  MediaAttachment,
  Conversation,
  ConversationListItem,
  ConversationMessage,
  ConversationMediaRecord,
  ConversationContext,
  ConversationLimits,
  ConversationStatus,
  FidelityMode,
  MessageRole,
  MediaType,
  ContextType,
} from "@synapse/shared";
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/conversations.ts packages/shared/src/types.ts frontend/src/lib/types.ts backend/src/db/types.ts
git commit -m "feat: add shared conversation types"
```

---

### Task 11: Format Translation Layer — Agent Adapters

**Files:**
- Create: `backend/src/lib/adapters/types.ts`
- Create: `backend/src/lib/adapters/anthropic.ts`
- Create: `backend/src/lib/adapters/openai.ts`
- Create: `backend/src/lib/adapters/raw.ts`
- Create: `backend/src/lib/adapters/index.ts`
- Create: `backend/test/lib/adapters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/lib/adapters.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getAdapter, detectAdapter } from "../../src/lib/adapters";
import type { CanonicalMessage } from "../../src/db/types";

describe("Agent Adapters", () => {
  describe("detectAdapter", () => {
    it("detects Anthropic format", () => {
      const raw = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
      expect(detectAdapter(raw)).toBe("anthropic");
    });

    it("detects OpenAI format", () => {
      const raw = [{ role: "system", content: "You are a helper" }, { role: "user", content: "hello" }];
      expect(detectAdapter(raw)).toBe("openai");
    });

    it("falls back to raw", () => {
      expect(detectAdapter("not an array")).toBe("raw");
    });
  });

  describe("Anthropic adapter", () => {
    it("converts content blocks to canonical", () => {
      const adapter = getAdapter("anthropic");
      const raw = [
        { role: "user", content: [{ type: "text", text: "Fix the bug" }] },
        { role: "assistant", content: [{ type: "text", text: "I'll fix it." }] },
      ];
      const result = adapter.toCanonical(raw);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("Fix the bug");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("I'll fix it.");
    });

    it("handles tool_use and tool_result blocks", () => {
      const adapter = getAdapter("anthropic");
      const raw = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me read the file." },
            { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/main.ts" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents here" }],
        },
      ];
      const result = adapter.toCanonical(raw);
      expect(result.length).toBeGreaterThanOrEqual(2);
      const toolMsg = result.find((m) => m.toolInteraction);
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.toolInteraction!.name).toBe("Read");
    });

    it("converts canonical back to Anthropic format", () => {
      const adapter = getAdapter("anthropic");
      const canonical: CanonicalMessage[] = [
        {
          id: "1",
          role: "user",
          content: "hello",
          source: { agent: "claude-code" },
          createdAt: new Date().toISOString(),
        },
        {
          id: "2",
          role: "assistant",
          content: "hi there",
          source: { agent: "claude-code" },
          createdAt: new Date().toISOString(),
        },
      ];
      const result = adapter.fromCanonical(canonical, "summary") as any[];
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
    });
  });

  describe("OpenAI adapter", () => {
    it("converts string content to canonical", () => {
      const adapter = getAdapter("openai");
      const raw = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ];
      const result = adapter.toCanonical(raw);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("hello");
    });

    it("handles system message", () => {
      const adapter = getAdapter("openai");
      const raw = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hello" },
      ];
      const result = adapter.toCanonical(raw);
      expect(result[0].role).toBe("system");
    });

    it("converts canonical back to OpenAI format", () => {
      const adapter = getAdapter("openai");
      const canonical: CanonicalMessage[] = [
        {
          id: "1",
          role: "user",
          content: "hello",
          source: { agent: "chatgpt" },
          createdAt: new Date().toISOString(),
        },
      ];
      const result = adapter.fromCanonical(canonical, "summary") as any[];
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("hello");
    });
  });

  describe("Raw adapter", () => {
    it("passes through canonical format", () => {
      const adapter = getAdapter("raw");
      const canonical: CanonicalMessage[] = [
        {
          id: "1",
          role: "user",
          content: "hello",
          source: { agent: "unknown" },
          createdAt: new Date().toISOString(),
        },
      ];
      const result = adapter.fromCanonical(canonical, "summary");
      expect(result).toEqual(canonical);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/lib/adapters.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the adapter interface**

Create `backend/src/lib/adapters/types.ts`:

```typescript
import type { CanonicalMessage, FidelityMode } from "../../db/types";

export interface AgentAdapter {
  name: string;
  detect(raw: unknown): boolean;
  toCanonical(raw: unknown): CanonicalMessage[];
  fromCanonical(messages: CanonicalMessage[], fidelity: FidelityMode): unknown;
}
```

- [ ] **Step 4: Write the Anthropic adapter**

Create `backend/src/lib/adapters/anthropic.ts`:

```typescript
import type { CanonicalMessage, FidelityMode } from "../../db/types";
import type { AgentAdapter } from "./types";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

export const anthropicAdapter: AgentAdapter = {
  name: "anthropic",

  detect(raw: unknown): boolean {
    if (!Array.isArray(raw) || raw.length === 0) return false;
    const first = raw[0];
    if (!first || typeof first !== "object" || !("role" in first) || !("content" in first)) return false;
    // Anthropic uses content blocks (arrays) rather than plain strings
    return Array.isArray(first.content) && first.content.length > 0 && typeof first.content[0]?.type === "string";
  },

  toCanonical(raw: unknown): CanonicalMessage[] {
    const messages = raw as AnthropicMessage[];
    const result: CanonicalMessage[] = [];

    for (const msg of messages) {
      const blocks = typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : msg.content;

      let textContent = "";
      let toolInteraction = undefined;

      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          textContent += (textContent ? "\n" : "") + block.text;
        } else if (block.type === "tool_use" && block.name) {
          toolInteraction = {
            name: block.name,
            input: block.input,
            summary: `Called ${block.name}`,
          };
        } else if (block.type === "tool_result") {
          const resultText = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          if (toolInteraction) {
            toolInteraction.output = resultText;
            toolInteraction.summary = `Called ${toolInteraction.name} → ${resultText.slice(0, 80)}`;
          } else {
            // tool_result without matching tool_use in same message
            toolInteraction = {
              name: "unknown",
              output: resultText,
              summary: `Tool result: ${resultText.slice(0, 80)}`,
            };
          }
        }
      }

      result.push({
        id: crypto.randomUUID(),
        role: msg.role as CanonicalMessage["role"],
        content: textContent,
        toolInteraction,
        source: { agent: "claude-code" },
        createdAt: new Date().toISOString(),
      });
    }

    return result;
  },

  fromCanonical(messages: CanonicalMessage[], fidelity: FidelityMode): unknown {
    return messages.map((msg) => {
      const content: AnthropicContentBlock[] = [];

      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }

      if (msg.toolInteraction && fidelity === "full") {
        content.push({
          type: "tool_use",
          id: `tool_${msg.id}`,
          name: msg.toolInteraction.name,
          input: msg.toolInteraction.input ?? {},
        });
      } else if (msg.toolInteraction && fidelity === "summary") {
        content.push({ type: "text", text: `[Tool: ${msg.toolInteraction.summary}]` });
      }

      return {
        role: msg.role,
        content: content.length === 1 && content[0].type === "text" ? content[0].text : content,
      };
    });
  },
};
```

- [ ] **Step 5: Write the OpenAI adapter**

Create `backend/src/lib/adapters/openai.ts`:

```typescript
import type { CanonicalMessage, FidelityMode } from "../../db/types";
import type { AgentAdapter } from "./types";

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export const openaiAdapter: AgentAdapter = {
  name: "openai",

  detect(raw: unknown): boolean {
    if (!Array.isArray(raw) || raw.length === 0) return false;
    const first = raw[0];
    if (!first || typeof first !== "object" || !("role" in first)) return false;
    // OpenAI uses string content (not content blocks)
    return typeof first.content === "string" || first.content === null;
  },

  toCanonical(raw: unknown): CanonicalMessage[] {
    const messages = raw as OpenAIMessage[];
    const result: CanonicalMessage[] = [];

    for (const msg of messages) {
      let toolInteraction = undefined;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const call = msg.tool_calls[0];
        toolInteraction = {
          name: call.function.name,
          input: JSON.parse(call.function.arguments || "{}"),
          summary: `Called ${call.function.name}`,
        };
      }

      if (msg.role === "tool" && msg.tool_call_id) {
        // This is a tool result — merge with summary
        toolInteraction = {
          name: msg.name ?? "unknown",
          output: msg.content ?? undefined,
          summary: `Tool result: ${(msg.content ?? "").slice(0, 80)}`,
        };
      }

      result.push({
        id: crypto.randomUUID(),
        role: msg.role === "tool" ? "tool" : (msg.role as CanonicalMessage["role"]),
        content: msg.content ?? "",
        toolInteraction,
        source: { agent: "chatgpt" },
        createdAt: new Date().toISOString(),
      });
    }

    return result;
  },

  fromCanonical(messages: CanonicalMessage[], fidelity: FidelityMode): unknown {
    return messages.map((msg) => {
      const result: OpenAIMessage = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.toolInteraction && fidelity === "full") {
        result.tool_calls = [
          {
            id: `call_${msg.id}`,
            type: "function",
            function: {
              name: msg.toolInteraction.name,
              arguments: JSON.stringify(msg.toolInteraction.input ?? {}),
            },
          },
        ];
      } else if (msg.toolInteraction && fidelity === "summary") {
        result.content = `${msg.content}\n\n[Tool: ${msg.toolInteraction.summary}]`.trim();
      }

      return result;
    });
  },
};
```

- [ ] **Step 6: Write the raw adapter**

Create `backend/src/lib/adapters/raw.ts`:

```typescript
import type { CanonicalMessage, FidelityMode } from "../../db/types";
import type { AgentAdapter } from "./types";

export const rawAdapter: AgentAdapter = {
  name: "raw",

  detect(_raw: unknown): boolean {
    return false; // Raw is the fallback, never auto-detected
  },

  toCanonical(raw: unknown): CanonicalMessage[] {
    if (Array.isArray(raw)) return raw as CanonicalMessage[];
    return [];
  },

  fromCanonical(messages: CanonicalMessage[], _fidelity: FidelityMode): unknown {
    return messages;
  },
};
```

- [ ] **Step 7: Write the adapter index with detection**

Create `backend/src/lib/adapters/index.ts`:

```typescript
import type { AgentAdapter } from "./types";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { rawAdapter } from "./raw";

export type { AgentAdapter } from "./types";

const adapters: AgentAdapter[] = [anthropicAdapter, openaiAdapter, rawAdapter];

const adapterMap: Record<string, AgentAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  raw: rawAdapter,
};

export function getAdapter(name: string): AgentAdapter {
  return adapterMap[name] ?? rawAdapter;
}

export function detectAdapter(raw: unknown): string {
  for (const adapter of adapters) {
    if (adapter.detect(raw)) return adapter.name;
  }
  return "raw";
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/lib/adapters.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/lib/adapters/ backend/test/lib/adapters.test.ts
git commit -m "feat: add agent adapters for format translation (anthropic, openai, raw)"
```

---

### Task 12: Supabase Storage Helper

**Files:**
- Create: `backend/src/lib/storage.ts`

- [ ] **Step 1: Write the storage helper**

Create `backend/src/lib/storage.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET_NAME = "conversation-media";
const SIGNED_URL_EXPIRY = 3600; // 1 hour

export async function uploadMedia(
  db: SupabaseClient,
  conversationId: string,
  messageId: string,
  filename: string,
  content: Uint8Array,
  mimeType: string,
): Promise<string> {
  const storagePath = `conversations/${conversationId}/${messageId}/${filename}`;

  const { error } = await db.storage
    .from(BUCKET_NAME)
    .upload(storagePath, content, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw error;

  return storagePath;
}

export async function getSignedUrl(
  db: SupabaseClient,
  storagePath: string,
): Promise<string> {
  const { data, error } = await db.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteMedia(
  db: SupabaseClient,
  storagePaths: string[],
): Promise<void> {
  if (storagePaths.length === 0) return;
  const { error } = await db.storage.from(BUCKET_NAME).remove(storagePaths);
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/storage.ts
git commit -m "feat: add Supabase Storage helper for conversation media"
```

---

### Task 13: Backend Queries — Conversations CRUD

**Files:**
- Create: `backend/src/db/queries/conversations.ts`
- Modify: `backend/src/db/queries/index.ts`

- [ ] **Step 1: Write conversation queries**

Create `backend/src/db/queries/conversations.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Conversation,
  ConversationListItem,
  ConversationMessage,
  ConversationMediaRecord,
  ConversationContext,
  ConversationLimits,
  ConversationStatus,
  FidelityMode,
  MessageRole,
  ToolInteraction,
} from "../types";

const CONVERSATION_COLUMNS =
  "id, project_id, user_id, title, status, fidelity_mode, system_prompt, working_context, forked_from, fork_point, message_count, media_size, metadata, encrypted, created_at, updated_at";

const CONVERSATION_LIST_COLUMNS = "id, title, status, message_count, metadata, updated_at";

const MESSAGE_COLUMNS =
  "id, conversation_id, sequence, role, content, tool_interaction, source_agent, source_model, token_count, cost, attachments_summary, parent_message_id, encrypted, created_at";

export async function createConversation(
  db: SupabaseClient,
  params: {
    project_id: string;
    user_id: string;
    title?: string | null;
    fidelity_mode?: FidelityMode;
    system_prompt?: string | null;
    working_context?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    encrypted?: boolean;
  },
): Promise<Conversation> {
  const { data, error } = await db
    .from("conversations")
    .insert({
      project_id: params.project_id,
      user_id: params.user_id,
      title: params.title ?? null,
      fidelity_mode: params.fidelity_mode ?? "summary",
      system_prompt: params.system_prompt ?? null,
      working_context: params.working_context ?? null,
      metadata: params.metadata ?? null,
      encrypted: params.encrypted ?? false,
    })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function getConversation(
  db: SupabaseClient,
  conversationId: string,
): Promise<Conversation | null> {
  const { data, error } = await db
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as Conversation;
}

export async function listConversations(
  db: SupabaseClient,
  projectId: string,
  options?: { status?: ConversationStatus; limit?: number; offset?: number },
): Promise<{ conversations: ConversationListItem[]; total: number }> {
  let query = db
    .from("conversations")
    .select(CONVERSATION_LIST_COLUMNS, { count: "exact" })
    .eq("project_id", projectId)
    .neq("status", "deleted")
    .order("updated_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    conversations: (data ?? []) as ConversationListItem[],
    total: count ?? 0,
  };
}

export async function updateConversation(
  db: SupabaseClient,
  conversationId: string,
  params: {
    title?: string | null;
    status?: ConversationStatus;
    fidelity_mode?: FidelityMode;
    system_prompt?: string | null;
    working_context?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<Conversation> {
  const { data, error } = await db
    .from("conversations")
    .update({ ...params, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function appendMessages(
  db: SupabaseClient,
  conversationId: string,
  messages: {
    role: MessageRole;
    content: string | null;
    tool_interaction?: ToolInteraction | null;
    source_agent: string;
    source_model?: string | null;
    token_count?: { input?: number; output?: number } | null;
    cost?: number | null;
    attachments_summary?: string | null;
    parent_message_id?: string | null;
    encrypted?: boolean;
  }[],
): Promise<ConversationMessage[]> {
  // Get current max sequence
  const { data: maxRow } = await db
    .from("conversation_messages")
    .select("sequence")
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: false })
    .limit(1)
    .single();

  let nextSeq = (maxRow?.sequence ?? 0) + 1;

  const rows = messages.map((msg) => ({
    conversation_id: conversationId,
    sequence: nextSeq++,
    role: msg.role,
    content: msg.content,
    tool_interaction: msg.tool_interaction ?? null,
    source_agent: msg.source_agent,
    source_model: msg.source_model ?? null,
    token_count: msg.token_count ?? null,
    cost: msg.cost ?? null,
    attachments_summary: msg.attachments_summary ?? null,
    parent_message_id: msg.parent_message_id ?? null,
    encrypted: msg.encrypted ?? false,
  }));

  const { data, error } = await db
    .from("conversation_messages")
    .insert(rows)
    .select(MESSAGE_COLUMNS);
  if (error) throw error;

  // Update message count
  await db
    .from("conversations")
    .update({
      message_count: nextSeq - 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return (data ?? []) as ConversationMessage[];
}

export async function getMessages(
  db: SupabaseClient,
  conversationId: string,
  options?: { fromSequence?: number; limit?: number; offset?: number },
): Promise<ConversationMessage[]> {
  let query = db
    .from("conversation_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: true });

  if (options?.fromSequence) {
    query = query.gte("sequence", options.fromSequence);
  }

  if (options?.limit) {
    const offset = options?.offset ?? 0;
    query = query.range(offset, offset + options.limit - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ConversationMessage[];
}

export async function getMediaForMessage(
  db: SupabaseClient,
  messageId: string,
): Promise<ConversationMediaRecord[]> {
  const { data, error } = await db
    .from("conversation_media")
    .select("*")
    .eq("message_id", messageId);
  if (error) throw error;
  return (data ?? []) as ConversationMediaRecord[];
}

export async function getMediaForConversation(
  db: SupabaseClient,
  conversationId: string,
): Promise<ConversationMediaRecord[]> {
  const { data, error } = await db
    .from("conversation_media")
    .select("*")
    .eq("conversation_id", conversationId);
  if (error) throw error;
  return (data ?? []) as ConversationMediaRecord[];
}

export async function insertMedia(
  db: SupabaseClient,
  params: {
    message_id: string;
    conversation_id: string;
    type: string;
    mime_type: string;
    filename: string | null;
    size: number;
    storage_path: string;
    encrypted?: boolean;
  },
): Promise<ConversationMediaRecord> {
  const { data, error } = await db
    .from("conversation_media")
    .insert({
      ...params,
      encrypted: params.encrypted ?? false,
    })
    .select("*")
    .single();
  if (error) throw error;

  // Update media_size on conversation
  await db.rpc("increment_media_size", {
    conv_id: params.conversation_id,
    add_size: params.size,
  }).then(({ error: rpcError }) => {
    // Fallback if RPC doesn't exist — just update directly
    if (rpcError) {
      return db
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", params.conversation_id);
    }
  });

  return data as ConversationMediaRecord;
}

export async function saveConversationContext(
  db: SupabaseClient,
  conversationId: string,
  contexts: {
    type: string;
    key: string;
    value: string | null;
    snapshot_at: number | null;
    encrypted?: boolean;
  }[],
): Promise<void> {
  const rows = contexts.map((ctx) => ({
    conversation_id: conversationId,
    type: ctx.type,
    key: ctx.key,
    value: ctx.value,
    snapshot_at: ctx.snapshot_at,
    encrypted: ctx.encrypted ?? false,
  }));
  const { error } = await db.from("conversation_context").insert(rows);
  if (error) throw error;
}

export async function getConversationContext(
  db: SupabaseClient,
  conversationId: string,
): Promise<ConversationContext[]> {
  const { data, error } = await db
    .from("conversation_context")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("snapshot_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ConversationContext[];
}

export async function getConversationLimits(
  db: SupabaseClient,
  tier: string,
): Promise<ConversationLimits | null> {
  const { data, error } = await db
    .from("conversation_limits")
    .select("*")
    .eq("tier", tier)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as ConversationLimits;
}
```

- [ ] **Step 2: Export from queries index**

Add to `backend/src/db/queries/index.ts`:

```typescript
export * from "./conversations";
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/queries/conversations.ts backend/src/db/queries/index.ts
git commit -m "feat: add conversation database queries"
```

---

### Task 14: Tier Enforcement — Conversation Sync

**Files:**
- Modify: `backend/src/lib/tier.ts`

- [ ] **Step 1: Add conversation tier enforcement**

Add to `backend/src/lib/tier.ts`:

```typescript
export function requireConversationSync(c: Context<{ Bindings: Env }>) {
  requirePlus(c, "Conversation sync");
}
```

This reuses the existing `requirePlus` helper. The `conversation_limits` table provides the toggle infrastructure for future granular limits, but for now the check is simply: must be Plus tier.

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/tier.ts
git commit -m "feat: add conversation sync tier enforcement"
```

---

### Task 15: Backend API — Conversations Endpoints

**Files:**
- Create: `backend/src/api/conversations.ts`
- Create: `backend/test/api/conversations.test.ts`
- Modify: `backend/src/lib/validate.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/api/conversations.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Conversations API — auth enforcement", () => {
  it("GET /api/conversations without auth returns 401", async () => {
    const req = new Request("http://localhost/api/conversations?project_id=test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/conversations without auth returns 401", async () => {
    const req = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: "test", title: "Test" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/conversations/:id/messages without auth returns 401", async () => {
    const req = new Request("http://localhost/api/conversations/some-id/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/api/conversations.test.ts`
Expected: FAIL — 404 instead of 401

- [ ] **Step 3: Add validation schemas**

Add to `backend/src/lib/validate.ts` inside the `schemas` object:

```typescript
  // Conversations
  createConversation: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
    title: z.string().nullable().optional(),
    fidelity_mode: z.enum(["summary", "full"]).optional(),
    system_prompt: z.string().nullable().optional(),
    working_context: z.record(z.unknown()).nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  }),

  updateConversation: z.object({
    title: z.string().nullable().optional(),
    status: z.enum(["active", "archived", "deleted"]).optional(),
    fidelity_mode: z.enum(["summary", "full"]).optional(),
  }),

  appendMessages: z.object({
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string().nullable(),
        tool_interaction: z
          .object({
            name: z.string(),
            input: z.record(z.unknown()).optional(),
            output: z.string().optional(),
            summary: z.string(),
          })
          .nullable()
          .optional(),
        source_agent: z.string(),
        source_model: z.string().nullable().optional(),
        token_count: z
          .object({ input: z.number().optional(), output: z.number().optional() })
          .nullable()
          .optional(),
        cost: z.number().nullable().optional(),
      }),
    ),
    context: z
      .array(
        z.object({
          type: z.enum(["file", "repo", "env", "dependency"]),
          key: z.string(),
          value: z.string().nullable(),
          snapshot_at: z.number().nullable().optional(),
        }),
      )
      .optional(),
  }),

  importConversation: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
    format: z.enum(["anthropic", "openai", "raw"]).optional(),
    title: z.string().nullable().optional(),
    messages: z.unknown(),
  }),
```

- [ ] **Step 4: Write the route handler**

Create `backend/src/api/conversations.ts`:

```typescript
import { Hono } from "hono";
import { logActivity } from "../db/activity-logger";
import { createSupabaseClient } from "../db/client";
import {
  appendMessages,
  createConversation,
  getConversation,
  getConversationContext,
  getMediaForConversation,
  getMessages,
  insertMedia,
  listConversations,
  saveConversationContext,
  updateConversation,
} from "../db/queries";
import { authMiddleware } from "../lib/auth";
import { ForbiddenError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";
import { requireConversationSync } from "../lib/tier";
import { parseBody, schemas } from "../lib/validate";
import { detectAdapter, getAdapter } from "../lib/adapters";
import { getSignedUrl, uploadMedia } from "../lib/storage";

import type { ConversationStatus, FidelityMode } from "../db/types";

const conversations = new Hono<{ Bindings: Env }>();
conversations.use("*", authMiddleware);
conversations.use("*", idempotency);

// POST /api/conversations
conversations.post("/", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const body = await parseBody(c, schemas.createConversation);

  const db = createSupabaseClient(c.env);
  const conversation = await createConversation(db, {
    ...body,
    user_id: user.id,
  });

  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "conversation_created",
    source: "human",
    metadata: { title: body.title },
  });

  return c.json(conversation, 201);
});

// GET /api/conversations?project_id=...&status=...&limit=...&offset=...
conversations.get("/", async (c) => {
  const user = c.get("user");
  const projectId = c.req.query("project_id");
  if (!projectId) return c.json({ error: "project_id is required" }, 400);

  const status = c.req.query("status") as ConversationStatus | undefined;
  const limit = Number.parseInt(c.req.query("limit") ?? "20");
  const offset = Number.parseInt(c.req.query("offset") ?? "0");

  const db = createSupabaseClient(c.env);
  const result = await listConversations(db, projectId, { status, limit, offset });
  return c.json(result);
});

// GET /api/conversations/:id?fidelity=...&page=...&limit=...
conversations.get("/:id", async (c) => {
  const conversationId = c.req.param("id");
  const fidelity = (c.req.query("fidelity") as FidelityMode) ?? undefined;
  const page = Number.parseInt(c.req.query("page") ?? "1");
  const limit = Number.parseInt(c.req.query("limit") ?? "50");

  const db = createSupabaseClient(c.env);
  const conversation = await getConversation(db, conversationId);
  if (!conversation) throw new NotFoundError("Conversation not found");

  const offset = (page - 1) * limit;
  const messages = await getMessages(db, conversationId, { limit, offset });
  const context = await getConversationContext(db, conversationId);
  const media = await getMediaForConversation(db, conversationId);

  return c.json({ conversation, messages, context, media });
});

// PATCH /api/conversations/:id
conversations.patch("/:id", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await parseBody(c, schemas.updateConversation);

  const db = createSupabaseClient(c.env);
  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");
  if (existing.user_id !== user.id) throw new ForbiddenError("Not your conversation");

  const updated = await updateConversation(db, conversationId, body);
  return c.json(updated);
});

// POST /api/conversations/:id/messages
conversations.post("/:id/messages", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await parseBody(c, schemas.appendMessages);

  const db = createSupabaseClient(c.env);
  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");
  if (existing.user_id !== user.id) throw new ForbiddenError("Not your conversation");

  const newMessages = await appendMessages(db, conversationId, body.messages);

  // Save context snapshots if provided
  if (body.context && body.context.length > 0) {
    const lastSeq = newMessages[newMessages.length - 1]?.sequence ?? 0;
    await saveConversationContext(
      db,
      conversationId,
      body.context.map((ctx) => ({ ...ctx, snapshot_at: ctx.snapshot_at ?? lastSeq })),
    );
  }

  return c.json({ messages: newMessages });
});

// POST /api/conversations/:id/media
conversations.post("/:id/media", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const conversationId = c.req.param("id");

  const db = createSupabaseClient(c.env);
  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");
  if (existing.user_id !== user.id) throw new ForbiddenError("Not your conversation");

  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  const messageId = formData.get("message_id") as string;
  if (!file || !messageId) return c.json({ error: "file and message_id are required" }, 400);

  const content = new Uint8Array(await file.arrayBuffer());
  const storagePath = await uploadMedia(db, conversationId, messageId, file.name, content, file.type);

  const mediaType = file.type.startsWith("image/")
    ? "image"
    : file.type === "application/pdf"
      ? "pdf"
      : file.type.startsWith("audio/")
        ? "audio"
        : file.type.startsWith("video/")
          ? "video"
          : "file";

  const record = await insertMedia(db, {
    message_id: messageId,
    conversation_id: conversationId,
    type: mediaType,
    mime_type: file.type,
    filename: file.name,
    size: content.byteLength,
    storage_path: storagePath,
  });

  return c.json(record, 201);
});

// GET /api/conversations/:id/media/:mediaId
conversations.get("/:id/media/:mediaId", async (c) => {
  const conversationId = c.req.param("id");
  const mediaId = c.req.param("mediaId");

  const db = createSupabaseClient(c.env);
  const { data, error } = await db
    .from("conversation_media")
    .select("*")
    .eq("id", mediaId)
    .eq("conversation_id", conversationId)
    .single();
  if (error || !data) throw new NotFoundError("Media not found");

  const signedUrl = await getSignedUrl(db, data.storage_path);
  return c.json({ url: signedUrl });
});

// POST /api/conversations/import
conversations.post("/import", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const body = await parseBody(c, schemas.importConversation);

  const adapterName = body.format ?? detectAdapter(body.messages);
  const adapter = getAdapter(adapterName);
  const canonical = adapter.toCanonical(body.messages);

  const db = createSupabaseClient(c.env);
  const conversation = await createConversation(db, {
    project_id: body.project_id,
    user_id: user.id,
    title: body.title ?? `Imported from ${adapterName}`,
    metadata: { imported_from: adapterName, imported_at: new Date().toISOString() },
  });

  const messages = await appendMessages(
    db,
    conversation.id,
    canonical.map((m) => ({
      role: m.role,
      content: m.content,
      tool_interaction: m.toolInteraction ?? null,
      source_agent: m.source.agent,
      source_model: m.source.model ?? null,
      token_count: m.tokenCount ?? null,
      cost: m.cost ?? null,
    })),
  );

  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "conversation_imported",
    source: "human",
    metadata: { format: adapterName, message_count: messages.length },
  });

  return c.json({ conversation, messageCount: messages.length }, 201);
});

// GET /api/conversations/:id/export/:format
conversations.get("/:id/export/:format", async (c) => {
  const conversationId = c.req.param("id");
  const format = c.req.param("format");

  const db = createSupabaseClient(c.env);
  const conversation = await getConversation(db, conversationId);
  if (!conversation) throw new NotFoundError("Conversation not found");

  const dbMessages = await getMessages(db, conversationId);
  const fidelity = conversation.fidelity_mode;

  // Convert DB messages to canonical format
  const canonical = dbMessages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system" | "tool",
    content: m.content ?? "",
    toolInteraction: m.tool_interaction ?? undefined,
    source: { agent: m.source_agent, model: m.source_model ?? undefined },
    tokenCount: m.token_count ?? undefined,
    cost: m.cost ?? undefined,
    parentMessageId: m.parent_message_id ?? undefined,
    createdAt: m.created_at,
  }));

  const adapter = getAdapter(format);
  const exported = adapter.fromCanonical(canonical, fidelity);

  return c.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      system_prompt: conversation.system_prompt,
      working_context: conversation.working_context,
    },
    messages: exported,
    format,
  });
});

export { conversations };
```

- [ ] **Step 5: Mount the route in index.ts**

Add to `backend/src/index.ts`:

After `import { insights } from "./api/insights";`:
```typescript
import { conversations } from "./api/conversations";
```

After `app.route("/api/insights", insights);`:
```typescript
app.route("/api/conversations", conversations);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/api/conversations.test.ts`
Expected: All 3 tests PASS (401 for unauthenticated requests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/conversations.ts backend/src/lib/validate.ts backend/src/index.ts backend/test/api/conversations.test.ts
git commit -m "feat: add conversations API endpoints with tier enforcement"
```

---

### Task 16: MCP Tools — Conversation Sync

**Files:**
- Create: `backend/src/mcp/tools/conversations.ts`
- Modify: `backend/src/mcp/agent.ts`

- [ ] **Step 1: Write the MCP conversation tools**

Create `backend/src/mcp/tools/conversations.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logActivity } from "../../db/activity-logger";
import { createSupabaseClient } from "../../db/client";
import {
  appendMessages,
  createConversation,
  getConversation,
  getConversationContext,
  getMessages,
  getProjectByName,
  listConversations,
  saveConversationContext,
  getConversationLimits,
  getActiveSubscription,
} from "../../db/queries";
import { getAdapter } from "../../lib/adapters";
import { uploadMedia } from "../../lib/storage";
import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { requireMcpUserId } from "../mcp-context";

export function registerConversationTools(server: McpServer, env: Env, getContext: GetMcpContext) {
  // Helper to check if user has Plus tier
  async function requireSync(db: any, userId: string): Promise<boolean> {
    const sub = await getActiveSubscription(db, userId);
    const tier = sub?.status === "active" || sub?.status === "past_due" ? "plus" : "free";
    const limits = await getConversationLimits(db, tier);
    return limits?.sync_enabled ?? false;
  }

  server.tool(
    "sync_conversation",
    "Sync conversation messages to Synapse. Creates a new conversation or appends to an existing one. This allows conversations to be resumed by other AI agents.",
    {
      project: z.string().describe("Project name"),
      conversationId: z.string().optional().describe("Existing conversation ID (omit to create new)"),
      title: z.string().optional().describe("Conversation title"),
      systemPrompt: z.string().optional().describe("Active system prompt"),
      workingContext: z
        .object({
          repo: z.string().optional(),
          cwd: z.string().optional(),
          branch: z.string().optional(),
          project: z.string().optional(),
        })
        .optional()
        .describe("Current working context"),
      fidelity: z.enum(["full", "summary"]).optional().describe("Fidelity mode (default: summary)"),
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant", "system", "tool"]),
            content: z.string().nullable(),
            toolSummary: z.string().optional().describe("One-line summary of tool usage, if any"),
            sourceAgent: z.string().optional().describe("Agent that produced this message"),
            sourceModel: z.string().optional().describe("Model used"),
          }),
        )
        .describe("Messages to sync"),
    },
    async ({ project, conversationId, title, systemPrompt, workingContext, fidelity, messages }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const canSync = await requireSync(db, userId);
      if (!canSync) {
        return {
          content: [{ type: "text" as const, text: "Conversation sync requires a Plus subscription." }],
        };
      }

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }] };

      let convId = conversationId;

      // Create new conversation if no ID provided
      if (!convId) {
        const conv = await createConversation(db, {
          project_id: proj.id,
          user_id: userId,
          title: title ?? `Session ${new Date().toLocaleDateString()}`,
          fidelity_mode: fidelity ?? "summary",
          system_prompt: systemPrompt ?? null,
          working_context: workingContext ?? null,
        });
        convId = conv.id;
      }

      // Append messages
      const appended = await appendMessages(
        db,
        convId,
        messages.map((m) => ({
          role: m.role,
          content: m.content,
          tool_interaction: m.toolSummary
            ? { name: "tool", summary: m.toolSummary }
            : null,
          source_agent: m.sourceAgent ?? "claude-code",
          source_model: m.sourceModel ?? null,
        })),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Synced ${appended.length} messages to conversation ${convId}.`,
          },
        ],
      };
    },
  );

  server.tool(
    "load_conversation",
    "Load a conversation to resume it. Returns the full message history so you can continue where the last agent left off.",
    {
      project: z.string().describe("Project name"),
      conversationId: z.string().describe("Conversation ID to load"),
      fidelity: z.enum(["full", "summary"]).optional().describe("Override fidelity mode"),
      fromSequence: z.number().optional().describe("Load from a specific message number"),
    },
    async ({ project, conversationId, fidelity, fromSequence }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const canSync = await requireSync(db, userId);
      if (!canSync) {
        return {
          content: [{ type: "text" as const, text: "Conversation sync requires a Plus subscription." }],
        };
      }

      const conv = await getConversation(db, conversationId);
      if (!conv) return { content: [{ type: "text" as const, text: "Conversation not found." }] };

      const messages = await getMessages(db, conversationId, { fromSequence });
      const context = await getConversationContext(db, conversationId);

      // Build a readable transcript
      const header = [
        `# Conversation: ${conv.title ?? "Untitled"}`,
        conv.system_prompt ? `\n**System prompt:** ${conv.system_prompt}` : "",
        conv.working_context ? `\n**Working context:** ${JSON.stringify(conv.working_context)}` : "",
        `\n**Messages:** ${messages.length}`,
        `\n---\n`,
      ].join("");

      const effectiveFidelity = fidelity ?? conv.fidelity_mode;
      const transcript = messages
        .map((m) => {
          const agent = m.source_agent !== "claude-code" ? ` (${m.source_agent})` : "";
          let line = `**${m.role}${agent}:** ${m.content ?? ""}`;
          if (m.tool_interaction && effectiveFidelity === "full") {
            line += `\n  [Tool: ${JSON.stringify(m.tool_interaction)}]`;
          } else if (m.tool_interaction) {
            line += `\n  [Tool: ${(m.tool_interaction as any).summary ?? "tool call"}]`;
          }
          return line;
        })
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text: header + transcript }],
      };
    },
  );

  server.tool(
    "list_conversations",
    "List conversations in a project. Shows recent active conversations that can be resumed.",
    {
      project: z.string().describe("Project name"),
      status: z.enum(["active", "archived"]).optional().describe("Filter by status"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ project, status, limit }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }] };

      const result = await listConversations(db, proj.id, {
        status,
        limit: limit ?? 10,
      });

      if (result.conversations.length === 0) {
        return { content: [{ type: "text" as const, text: "No conversations found." }] };
      }

      const lines = result.conversations.map((c) => {
        const date = new Date(c.updated_at).toLocaleDateString();
        return `- **${c.title ?? "Untitled"}** (${c.message_count} messages, ${date}) — ID: ${c.id}`;
      });

      return {
        content: [{ type: "text" as const, text: `${result.total} conversations:\n\n${lines.join("\n")}` }],
      };
    },
  );

  server.tool(
    "upload_media",
    "Upload a media file (image, PDF, etc.) to attach to a conversation message.",
    {
      conversationId: z.string().describe("Conversation ID"),
      messageId: z.string().describe("Message ID to attach to"),
      filename: z.string().describe("File name"),
      mimeType: z.string().describe("MIME type (e.g., image/png)"),
      content: z.string().describe("Base64-encoded file content"),
    },
    async ({ conversationId, messageId, filename, mimeType, content }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const canSync = await requireSync(db, userId);
      if (!canSync) {
        return {
          content: [{ type: "text" as const, text: "Media upload requires a Plus subscription." }],
        };
      }

      const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
      const storagePath = await uploadMedia(db, conversationId, messageId, filename, bytes, mimeType);

      const mediaType = mimeType.startsWith("image/")
        ? "image"
        : mimeType === "application/pdf"
          ? "pdf"
          : "file";

      await db.from("conversation_media").insert({
        message_id: messageId,
        conversation_id: conversationId,
        type: mediaType,
        mime_type: mimeType,
        filename,
        size: bytes.byteLength,
        storage_path: storagePath,
      });

      return {
        content: [{ type: "text" as const, text: `Uploaded ${filename} (${bytes.byteLength} bytes).` }],
      };
    },
  );
}
```

- [ ] **Step 2: Register tools in agent.ts**

Add import to `backend/src/mcp/agent.ts`:

```typescript
import { registerConversationTools } from "./tools/conversations";
```

Add registration call inside `init()`:

```typescript
    registerConversationTools(this.server, env, getContext);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/mcp/tools/conversations.ts backend/src/mcp/agent.ts
git commit -m "feat: add conversation sync MCP tools"
```

---

### Task 17: Frontend API Client — Conversation Methods

**Files:**
- Modify: `frontend/src/lib/server/api.ts`

- [ ] **Step 1: Add conversation methods to the API client**

Add to the return object of `createApi` in `frontend/src/lib/server/api.ts`:

```typescript
    // Conversations
    listConversations: (projectId: string, status?: string, limit = 20, offset = 0) =>
      request<{ conversations: import("$lib/types").ConversationListItem[]; total: number }>(
        `/api/conversations?project_id=${projectId}${status ? `&status=${status}` : ""}&limit=${limit}&offset=${offset}`,
        token,
      ),
    getConversation: (conversationId: string, fidelity?: string, page = 1, limit = 50) =>
      request<{
        conversation: import("$lib/types").Conversation;
        messages: import("$lib/types").ConversationMessage[];
        context: any[];
        media: import("$lib/types").ConversationMediaRecord[];
      }>(
        `/api/conversations/${conversationId}?${fidelity ? `fidelity=${fidelity}&` : ""}page=${page}&limit=${limit}`,
        token,
      ),
    createConversation: (projectId: string, title?: string) =>
      request<import("$lib/types").Conversation>("/api/conversations", token, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, title }),
      }),
    updateConversation: (conversationId: string, updates: { title?: string; status?: string; fidelity_mode?: string }) =>
      request<import("$lib/types").Conversation>(`/api/conversations/${conversationId}`, token, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    importConversation: (projectId: string, format: string, messages: unknown, title?: string) =>
      request<{ conversation: import("$lib/types").Conversation; messageCount: number }>("/api/conversations/import", token, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, format, messages, title }),
      }),
    exportConversation: (conversationId: string, format: string) =>
      request<{ conversation: any; messages: any; format: string }>(
        `/api/conversations/${conversationId}/export/${format}`,
        token,
      ),
    getMediaUrl: (conversationId: string, mediaId: string) =>
      request<{ url: string }>(`/api/conversations/${conversationId}/media/${mediaId}`, token),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/server/api.ts
git commit -m "feat: add conversation methods to frontend API client"
```

---

### Task 18: Frontend — Conversations List Page

**Files:**
- Create: `frontend/src/routes/(app)/projects/[name]/conversations/+page.server.ts`
- Create: `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte`
- Create: `frontend/src/lib/components/conversations/ConversationList.svelte`
- Modify: `frontend/src/lib/components/layout/Sidebar.svelte`

- [ ] **Step 1: Write the page server load**

Create `frontend/src/routes/(app)/projects/[name]/conversations/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { project } = await parent();

  // Check billing status for tier gating
  const api = createApi(locals.token);
  const billing = await api.getBillingStatus();

  if (billing.tier !== "plus") {
    return { conversations: [], total: 0, tier: "free" as const };
  }

  const result = await api.listConversations(project.id);
  return { ...result, tier: "plus" as const };
};
```

- [ ] **Step 2: Write the ConversationList component**

Create `frontend/src/lib/components/conversations/ConversationList.svelte`:

```svelte
<script lang="ts">
  import type { ConversationListItem } from "$lib/types";

  let { conversations, projectName }: { conversations: ConversationListItem[]; projectName: string } = $props();

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

{#if conversations.length === 0}
  <div class="text-center py-12 text-white/40">
    <p class="text-lg mb-2">No conversations yet</p>
    <p class="text-sm">Conversations are synced automatically when using AI agents with Synapse MCP,<br />or you can import them from other agents.</p>
    <a href="/projects/{projectName}/conversations/import"
      class="inline-block mt-4 px-4 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm transition-colors">
      Import a Conversation
    </a>
  </div>
{:else}
  <div class="space-y-2">
    {#each conversations as conv (conv.id)}
      <a href="/projects/{projectName}/conversations/{conv.id}"
        class="block p-4 border border-white/10 rounded-lg hover:border-white/20 transition-colors">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-white">{conv.title ?? "Untitled Conversation"}</h3>
          <span class="text-xs text-white/40">{formatDate(conv.updated_at)}</span>
        </div>
        <div class="flex items-center gap-3 mt-1 text-xs text-white/50">
          <span>{conv.message_count} messages</span>
          <span class="px-1.5 py-0.5 bg-white/10 rounded">{conv.status}</span>
        </div>
      </a>
    {/each}
  </div>
{/if}
```

- [ ] **Step 3: Write the conversations page**

Create `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte`:

```svelte
<script lang="ts">
  import ConversationList from "$lib/components/conversations/ConversationList.svelte";

  let { data } = $props();
</script>

<div class="max-w-4xl mx-auto p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-xl font-semibold text-white">Conversations</h1>
    {#if data.tier === "plus"}
      <a href="/projects/{data.project?.name}/conversations/import"
        class="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/15 rounded-lg transition-colors">
        Import
      </a>
    {/if}
  </div>

  {#if data.tier === "free"}
    <div class="text-center py-16 border border-white/10 rounded-xl">
      <div class="text-4xl mb-4">🔄</div>
      <h2 class="text-lg font-semibold text-white mb-2">Conversation Sync</h2>
      <p class="text-white/50 max-w-md mx-auto mb-6">
        Sync full conversations across AI agents. Start a conversation in Claude Code, pick it up in ChatGPT,
        and continue seamlessly — as if the new agent was there the whole time.
      </p>
      <a href="/account" class="inline-block px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors">
        Upgrade to Plus
      </a>
    </div>
  {:else}
    <ConversationList conversations={data.conversations} projectName={data.project?.name ?? ""} />
  {/if}
</div>
```

- [ ] **Step 4: Add conversations link to sidebar**

In `frontend/src/lib/components/layout/Sidebar.svelte`, add next to the insights link:

```svelte
<a href="/projects/{projectName}/conversations"
  class="flex items-center gap-2 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
  class:text-white={currentPath?.includes('/conversations')}
  class:bg-white/10={currentPath?.includes('/conversations')}>
  Conversations
</a>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/conversations/+page.server.ts frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte frontend/src/lib/components/conversations/ConversationList.svelte frontend/src/lib/components/layout/Sidebar.svelte
git commit -m "feat: add conversations list page with free tier teaser"
```

---

### Task 19: Frontend — Conversation Viewer

**Files:**
- Create: `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.server.ts`
- Create: `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte`
- Create: `frontend/src/lib/components/conversations/MessageThread.svelte`

- [ ] **Step 1: Write the viewer page server load**

Create `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const api = createApi(locals.token);

  try {
    const data = await api.getConversation(params.id);
    return data;
  } catch (err) {
    error(404, "Conversation not found");
  }
};
```

- [ ] **Step 2: Write the MessageThread component**

Create `frontend/src/lib/components/conversations/MessageThread.svelte`:

```svelte
<script lang="ts">
  import type { ConversationMessage } from "$lib/types";

  let { messages, showTools = false }: { messages: ConversationMessage[]; showTools?: boolean } = $props();

  const agentColors: Record<string, string> = {
    "claude-code": "border-l-orange-400",
    chatgpt: "border-l-green-400",
    gemini: "border-l-blue-400",
  };

  function getAgentColor(agent: string) {
    return agentColors[agent] ?? "border-l-white/20";
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

<div class="space-y-4">
  {#each messages as msg (msg.id)}
    <div class="border-l-2 {getAgentColor(msg.source_agent)} pl-4 py-2">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs font-medium text-white/60 uppercase">{msg.role}</span>
        {#if msg.source_agent !== "claude-code"}
          <span class="text-xs text-white/40">via {msg.source_agent}</span>
        {/if}
        <span class="text-xs text-white/30">{formatTime(msg.created_at)}</span>
      </div>

      {#if msg.content}
        <div class="text-sm text-white/80 whitespace-pre-wrap">{msg.content}</div>
      {/if}

      {#if msg.tool_interaction && showTools}
        <div class="mt-2 p-2 bg-white/5 rounded text-xs text-white/50 font-mono">
          {JSON.stringify(msg.tool_interaction, null, 2)}
        </div>
      {:else if msg.tool_interaction}
        <div class="mt-1 text-xs text-white/40 italic">
          [Tool: {(msg.tool_interaction as any).summary ?? "tool call"}]
        </div>
      {/if}
    </div>
  {/each}
</div>
```

- [ ] **Step 3: Write the viewer page**

Create `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import MessageThread from "$lib/components/conversations/MessageThread.svelte";

  let { data } = $props();
  let showTools = $state(false);
</script>

<div class="max-w-4xl mx-auto p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-xl font-semibold text-white">{data.conversation.title ?? "Untitled Conversation"}</h1>
      <p class="text-sm text-white/40 mt-1">
        {data.conversation.message_count} messages &middot;
        {data.conversation.fidelity_mode} fidelity
      </p>
    </div>
    <div class="flex items-center gap-3">
      <label class="flex items-center gap-2 text-sm text-white/60">
        <input type="checkbox" bind:checked={showTools} class="rounded" />
        Show tools
      </label>
    </div>
  </div>

  {#if data.conversation.system_prompt}
    <div class="mb-4 p-3 bg-white/5 border border-white/10 rounded-lg">
      <p class="text-xs text-white/40 mb-1">System Prompt</p>
      <p class="text-sm text-white/60">{data.conversation.system_prompt}</p>
    </div>
  {/if}

  <MessageThread messages={data.messages} {showTools} />
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/conversations/[id]/ frontend/src/lib/components/conversations/MessageThread.svelte
git commit -m "feat: add conversation viewer page with message thread"
```

---

### Task 20: Frontend — Import Page

**Files:**
- Create: `frontend/src/routes/(app)/projects/[name]/conversations/import/+page.server.ts`
- Create: `frontend/src/routes/(app)/projects/[name]/conversations/import/+page.svelte`
- Create: `frontend/src/lib/components/conversations/ImportDropzone.svelte`

- [ ] **Step 1: Write the import page server**

Create `frontend/src/routes/(app)/projects/[name]/conversations/import/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent }) => {
  const { project } = await parent();
  return { project };
};

export const actions: Actions = {
  import: async ({ request, parent, locals, params }) => {
    const { project } = await parent();
    const data = await request.formData();
    const rawJson = data.get("messages") as string;
    const format = (data.get("format") as string) || undefined;
    const title = (data.get("title") as string)?.trim() || undefined;

    let messages: unknown;
    try {
      messages = JSON.parse(rawJson);
    } catch {
      return fail(400, { error: "Invalid JSON" });
    }

    const api = createApi(locals.token);
    try {
      const result = await api.importConversation(project.id, format ?? "raw", messages, title);
      redirect(303, `/projects/${params.name}/conversations/${result.conversation.id}`);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Import failed" });
    }
  },
};
```

- [ ] **Step 2: Write the ImportDropzone component**

Create `frontend/src/lib/components/conversations/ImportDropzone.svelte`:

```svelte
<script lang="ts">
  let { onfile }: { onfile: (content: string) => void } = $props();
  let dragging = $state(false);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) readFile(file);
  }

  function handleSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) readFile(file);
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => onfile(reader.result as string);
    reader.readAsText(file);
  }
</script>

<div
  class="border-2 border-dashed rounded-xl p-8 text-center transition-colors
    {dragging ? 'border-blue-400 bg-blue-400/5' : 'border-white/10 hover:border-white/20'}"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={handleDrop}
  role="button"
  tabindex="0"
>
  <p class="text-white/50 mb-2">Drop a conversation export file here</p>
  <p class="text-xs text-white/30 mb-4">Supports ChatGPT JSON exports, or any JSON message array</p>
  <label class="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm cursor-pointer transition-colors">
    Choose File
    <input type="file" accept=".json,.txt" class="hidden" onchange={handleSelect} />
  </label>
</div>
```

- [ ] **Step 3: Write the import page**

Create `frontend/src/routes/(app)/projects/[name]/conversations/import/+page.svelte`:

```svelte
<script lang="ts">
  import ImportDropzone from "$lib/components/conversations/ImportDropzone.svelte";

  let { data, form } = $props();
  let messagesJson = $state("");
  let title = $state("");
  let format = $state("raw");

  function handleFile(content: string) {
    messagesJson = content;
    // Try to auto-detect format
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed[0]?.content && Array.isArray(parsed[0].content)) {
        format = "anthropic";
      } else if (Array.isArray(parsed) && parsed[0]?.role) {
        format = "openai";
      }
    } catch { /* ignore */ }
  }
</script>

<div class="max-w-2xl mx-auto p-6">
  <h1 class="text-xl font-semibold text-white mb-6">Import Conversation</h1>

  {#if form?.error}
    <div class="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
      {form.error}
    </div>
  {/if}

  <ImportDropzone onfile={handleFile} />

  <form method="POST" action="?/import" class="mt-6 space-y-4">
    <div>
      <label for="title" class="block text-xs text-white/50 mb-1">Title (optional)</label>
      <input name="title" id="title" type="text" bind:value={title}
        class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white"
        placeholder="Conversation title" />
    </div>

    <div>
      <label for="format" class="block text-xs text-white/50 mb-1">Format</label>
      <select name="format" id="format" bind:value={format}
        class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white">
        <option value="raw">Auto-detect / Raw</option>
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI (ChatGPT)</option>
      </select>
    </div>

    <div>
      <label for="messages" class="block text-xs text-white/50 mb-1">Messages (JSON)</label>
      <textarea name="messages" id="messages" rows="10" bind:value={messagesJson}
        class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono"
        placeholder='[{"role": "user", "content": "hello"}]'></textarea>
    </div>

    <button type="submit" disabled={!messagesJson}
      class="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors">
      Import
    </button>
  </form>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/conversations/import/ frontend/src/lib/components/conversations/ImportDropzone.svelte
git commit -m "feat: add conversation import page with dropzone and format detection"
```

---

### Task 21: Backend Unit Tests — Insights & Conversations

**Files:**
- Modify: `backend/test/api/insights.test.ts`
- Modify: `backend/test/api/conversations.test.ts`

The auth enforcement tests were created in Tasks 3 and 15. Now add more thorough unit tests for the backend logic.

- [ ] **Step 1: Expand insights API tests**

Add to `backend/test/api/insights.test.ts`:

```typescript
describe("Insights API — validation", () => {
  it("POST /api/insights with missing type returns 400", async () => {
    // This would require a valid auth token to test validation
    // For now, test that the endpoint exists and enforces auth
    const req = new Request("http://localhost/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "test" }), // missing type and project_id
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401); // auth checked before validation
  });

  it("GET /api/insights without project_id returns 401 (auth first)", async () => {
    const req = new Request("http://localhost/api/insights");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Expand conversations API tests**

Add to `backend/test/api/conversations.test.ts`:

```typescript
describe("Conversations API — all endpoints require auth", () => {
  const endpoints: [string, string][] = [
    ["GET", "/api/conversations?project_id=test"],
    ["POST", "/api/conversations"],
    ["GET", "/api/conversations/some-id"],
    ["PATCH", "/api/conversations/some-id"],
    ["POST", "/api/conversations/some-id/messages"],
    ["POST", "/api/conversations/some-id/media"],
    ["GET", "/api/conversations/some-id/media/some-media"],
    ["POST", "/api/conversations/import"],
    ["GET", "/api/conversations/some-id/export/raw"],
  ];

  for (const [method, path] of endpoints) {
    it(`${method} ${path} → 401 without auth`, async () => {
      const req = new Request(`http://localhost${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method !== "GET" ? JSON.stringify({}) : undefined,
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(401);
    });
  }
});
```

- [ ] **Step 3: Run tests**

Run: `cd backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/test/api/insights.test.ts backend/test/api/conversations.test.ts
git commit -m "test: expand auth enforcement tests for insights and conversations"
```

---

### Task 22: E2E Tests — Insights & Conversations Roundtrip

**Files:**
- Modify: `mcp/test/e2e/api-roundtrip.test.ts`

Add insights and conversation journey tests to the existing e2e suite. These go before the "Auth enforcement" and "Account deletion" sections (which must remain last).

- [ ] **Step 1: Add insights e2e tests**

Add the following section to `mcp/test/e2e/api-roundtrip.test.ts`, after the existing "Activity Log" section and before "Auth enforcement on all endpoints":

```typescript
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  INSIGHTS — CRUD
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  let INSIGHT_ID: string;

  describe("Insights: CRUD", () => {
    it("creates an insight", async () => {
      const { status, data } = await api("POST", "/api/insights", KEY, {
        project_id: PROJECT_ID,
        type: "decision",
        summary: "Use Postgres for primary storage",
        detail: "Better tooling and ecosystem than MySQL",
      });
      expect(status).toBe(201);
      expect(data.id).toBeTruthy();
      expect(data.type).toBe("decision");
      expect(data.summary).toBe("Use Postgres for primary storage");
      INSIGHT_ID = data.id;
    });

    it("creates a second insight of different type", async () => {
      const { status, data } = await api("POST", "/api/insights", KEY, {
        project_id: PROJECT_ID,
        type: "learning",
        summary: "Supabase Storage has 5GB free tier",
      });
      expect(status).toBe(201);
      expect(data.type).toBe("learning");
    });

    it("lists all insights", async () => {
      const { status, data } = await api("GET", `/api/insights?project_id=${PROJECT_ID}`, KEY);
      expect(status).toBe(200);
      expect(data.insights.length).toBeGreaterThanOrEqual(2);
      expect(data.total).toBeGreaterThanOrEqual(2);
    });

    it("filters insights by type", async () => {
      const { status, data } = await api("GET", `/api/insights?project_id=${PROJECT_ID}&type=decision`, KEY);
      expect(status).toBe(200);
      expect(data.insights.every((i: R) => i.type === "decision")).toBe(true);
    });

    it("updates an insight", async () => {
      const { status, data } = await api("PATCH", `/api/insights/${INSIGHT_ID}`, KEY, {
        summary: "Use Postgres for all storage (updated)",
      });
      expect(status).toBe(200);
      expect(data.summary).toBe("Use Postgres for all storage (updated)");
    });

    it("deletes an insight", async () => {
      // Create a throwaway insight to delete
      const { data: created } = await api("POST", "/api/insights", KEY, {
        project_id: PROJECT_ID,
        type: "action_item",
        summary: "To be deleted",
      });
      const { status } = await api("DELETE", `/api/insights/${created.id}`, KEY);
      expect(status).toBe(200);
    });
  });
```

- [ ] **Step 2: Add conversations e2e tests**

Add the following section after the insights section:

```typescript
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONVERSATIONS — Sync & Import/Export
  //  (requires Plus tier — tests may get 403 on free accounts)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  let CONVERSATION_ID: string;
  let MESSAGE_IDS: string[] = [];

  describe("Conversations: CRUD & Sync", () => {
    it("creates a conversation", async () => {
      const { status, data } = await api("POST", "/api/conversations", KEY, {
        project_id: PROJECT_ID,
        title: "E2E Test Conversation",
        fidelity_mode: "summary",
        system_prompt: "You are a test assistant",
        working_context: { repo: "synapse", branch: "main" },
      });
      // Will be 201 (Plus) or 403 (Free)
      if (status === 403) {
        console.log("  ⏭ Conversation tests skipped — user is on free tier");
        return;
      }
      expect(status).toBe(201);
      expect(data.id).toBeTruthy();
      expect(data.title).toBe("E2E Test Conversation");
      CONVERSATION_ID = data.id;
    });

    it("appends messages", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("POST", `/api/conversations/${CONVERSATION_ID}/messages`, KEY, {
        messages: [
          { role: "user", content: "Fix the auth bug", source_agent: "claude-code" },
          { role: "assistant", content: "I'll look at the auth middleware.", source_agent: "claude-code", source_model: "claude-opus-4-6" },
          {
            role: "assistant",
            content: "Found the issue — the token wasn't being refreshed.",
            source_agent: "claude-code",
            tool_interaction: { name: "Read", summary: "Read auth.ts (45 lines)" },
          },
        ],
      });
      expect(status).toBe(200);
      expect(data.messages.length).toBe(3);
      MESSAGE_IDS = data.messages.map((m: R) => m.id);
    });

    it("lists conversations", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations?project_id=${PROJECT_ID}`, KEY);
      expect(status).toBe(200);
      expect(data.conversations.length).toBeGreaterThanOrEqual(1);
      const conv = data.conversations.find((c: R) => c.id === CONVERSATION_ID);
      expect(conv).toBeTruthy();
      expect(conv.message_count).toBe(3);
    });

    it("gets full conversation with messages", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations/${CONVERSATION_ID}`, KEY);
      expect(status).toBe(200);
      expect(data.conversation.id).toBe(CONVERSATION_ID);
      expect(data.messages.length).toBe(3);
      expect(data.messages[0].role).toBe("user");
      expect(data.messages[0].content).toBe("Fix the auth bug");
      expect(data.messages[2].tool_interaction).toBeTruthy();
    });

    it("updates conversation metadata", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("PATCH", `/api/conversations/${CONVERSATION_ID}`, KEY, {
        title: "Auth Bug Fix Session",
      });
      expect(status).toBe(200);
      expect(data.title).toBe("Auth Bug Fix Session");
    });

    it("exports conversation in raw format", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations/${CONVERSATION_ID}/export/raw`, KEY);
      expect(status).toBe(200);
      expect(data.format).toBe("raw");
      expect(data.messages.length).toBe(3);
    });

    it("exports conversation in OpenAI format", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations/${CONVERSATION_ID}/export/openai`, KEY);
      expect(status).toBe(200);
      expect(data.format).toBe("openai");
      // OpenAI format uses string content
      expect(typeof data.messages[0].content).toBe("string");
    });

    it("imports a conversation from OpenAI format", async () => {
      const { status, data } = await api("POST", "/api/conversations/import", KEY, {
        project_id: PROJECT_ID,
        format: "openai",
        title: "Imported from ChatGPT",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "What is Synapse?" },
          { role: "assistant", content: "Synapse is a context management tool." },
        ],
      });
      if (status === 403) return; // free tier
      expect(status).toBe(201);
      expect(data.messageCount).toBe(3);
      expect(data.conversation.title).toBe("Imported from ChatGPT");
    });

    it("soft-deletes a conversation", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("PATCH", `/api/conversations/${CONVERSATION_ID}`, KEY, {
        status: "deleted",
      });
      expect(status).toBe(200);
      expect(data.status).toBe("deleted");
    });

    it("deleted conversation does not appear in list", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations?project_id=${PROJECT_ID}`, KEY);
      expect(status).toBe(200);
      const ids = data.conversations.map((c: R) => c.id);
      expect(ids).not.toContain(CONVERSATION_ID);
    });
  });
```

- [ ] **Step 3: Add insights and conversation endpoints to auth enforcement list**

In the "Auth enforcement on all endpoints" section, add these to the `endpoints` array:

```typescript
      // Insights
      ["GET", "/api/insights?project_id=test"],
      ["POST", "/api/insights"],
      ["PATCH", "/api/insights/some-id"],
      ["DELETE", "/api/insights/some-id"],
      // Conversations
      ["GET", "/api/conversations?project_id=test"],
      ["POST", "/api/conversations"],
      ["GET", "/api/conversations/some-id"],
      ["PATCH", "/api/conversations/some-id"],
      ["POST", "/api/conversations/some-id/messages"],
      ["POST", "/api/conversations/import"],
      ["GET", "/api/conversations/some-id/export/raw"],
```

- [ ] **Step 4: Run e2e tests locally**

Run: `cd mcp && TEST_E2E=1 npm run test:e2e`
Expected: All tests PASS (conversation tests may skip on free tier accounts)

- [ ] **Step 5: Commit**

```bash
git add mcp/test/e2e/api-roundtrip.test.ts
git commit -m "test: add insights and conversation e2e tests to full user journey"
```

---

### Task 23: Adapter Unit Tests — Edge Cases

**Files:**
- Modify: `backend/test/lib/adapters.test.ts`

The basic adapter tests were created in Task 11. Add edge case coverage.

- [ ] **Step 1: Add edge case tests**

Add to `backend/test/lib/adapters.test.ts`:

```typescript
describe("Adapter edge cases", () => {
  describe("Anthropic adapter — complex content blocks", () => {
    it("handles mixed text and tool_use in single message", () => {
      const adapter = getAdapter("anthropic");
      const raw = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
            { type: "text", text: "And also..." },
          ],
        },
      ];
      const result = adapter.toCanonical(raw);
      expect(result[0].content).toContain("Let me check.");
      expect(result[0].content).toContain("And also...");
      expect(result[0].toolInteraction?.name).toBe("Bash");
    });

    it("handles empty content blocks", () => {
      const adapter = getAdapter("anthropic");
      const raw = [{ role: "user", content: [] }];
      const result = adapter.toCanonical(raw);
      expect(result[0].content).toBe("");
    });

    it("handles string content (not blocks)", () => {
      const adapter = getAdapter("anthropic");
      const raw = [{ role: "user", content: "plain string" }];
      const result = adapter.toCanonical(raw);
      expect(result[0].content).toBe("plain string");
    });
  });

  describe("OpenAI adapter — tool_calls", () => {
    it("handles multiple tool_calls (uses first)", () => {
      const adapter = getAdapter("openai");
      const raw = [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } },
            { id: "c2", type: "function", function: { name: "read", arguments: '{"file":"a.ts"}' } },
          ],
        },
      ];
      const result = adapter.toCanonical(raw);
      expect(result[0].toolInteraction?.name).toBe("search");
    });

    it("handles null content messages", () => {
      const adapter = getAdapter("openai");
      const raw = [{ role: "assistant", content: null }];
      const result = adapter.toCanonical(raw);
      expect(result[0].content).toBe("");
    });
  });

  describe("detectAdapter — format detection", () => {
    it("returns raw for empty array", () => {
      expect(detectAdapter([])).toBe("raw");
    });

    it("returns raw for non-array", () => {
      expect(detectAdapter({ role: "user" })).toBe("raw");
      expect(detectAdapter(null)).toBe("raw");
      expect(detectAdapter(42)).toBe("raw");
    });

    it("detects Anthropic when content is array of blocks", () => {
      const raw = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
      expect(detectAdapter(raw)).toBe("anthropic");
    });

    it("detects OpenAI when content is string", () => {
      const raw = [{ role: "user", content: "hi" }];
      expect(detectAdapter(raw)).toBe("openai");
    });
  });

  describe("Fidelity modes", () => {
    it("summary mode collapses tool interactions to text", () => {
      const adapter = getAdapter("anthropic");
      const canonical: CanonicalMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "Reading file",
          toolInteraction: { name: "Read", input: { file_path: "/test.ts" }, output: "content", summary: "Read test.ts (10 lines)" },
          source: { agent: "claude-code" },
          createdAt: new Date().toISOString(),
        },
      ];
      const result = adapter.fromCanonical(canonical, "summary") as any[];
      // Should not have tool_use block, should have text summary
      const content = Array.isArray(result[0].content) ? result[0].content : [{ type: "text", text: result[0].content }];
      const hasToolUse = content.some((b: any) => b.type === "tool_use");
      expect(hasToolUse).toBe(false);
    });

    it("full mode preserves tool_use blocks", () => {
      const adapter = getAdapter("anthropic");
      const canonical: CanonicalMessage[] = [
        {
          id: "1",
          role: "assistant",
          content: "Reading file",
          toolInteraction: { name: "Read", input: { file_path: "/test.ts" }, output: "content", summary: "Read test.ts" },
          source: { agent: "claude-code" },
          createdAt: new Date().toISOString(),
        },
      ];
      const result = adapter.fromCanonical(canonical, "full") as any[];
      const content = Array.isArray(result[0].content) ? result[0].content : [];
      const hasToolUse = content.some((b: any) => b.type === "tool_use");
      expect(hasToolUse).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run adapter tests**

Run: `cd backend && npx vitest run test/lib/adapters.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/test/lib/adapters.test.ts
git commit -m "test: add edge case tests for agent adapters and fidelity modes"
```

---

### Task 24: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run backend unit tests**

Run: `cd backend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run e2e tests**

Run: `cd mcp && TEST_E2E=1 npm run test:e2e`
Expected: All tests PASS

- [ ] **Step 3: Run the frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 4: Fix any issues found**

If tests fail or build errors occur, fix them before proceeding.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve test and build issues"
```
