# Frontend Rebuild — Conversations-First

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Synapse frontend around conversations as the primary data model with 6 pages, replacing the filesystem-centric UI.

**Architecture:** SvelteKit 2.55 + Svelte 5 (Runes) + Tailwind 4. Keep AppShell and glassmorphism design system. Rebuild all page contents. Backend changes are minimal — lift tier gates, add quota middleware, add project stats.

**Tech Stack:** SvelteKit, Svelte 5 ($state/$derived/$props), Tailwind 4, TypeScript, Hono (backend), Supabase (DB)

---

### Task 1: Backend — Lift Conversations to Free Tier

**Files:**
- Modify: `backend/src/api/conversations.ts` (remove requirePlus gate)
- Modify: `backend/src/lib/tier.ts` (remove requireConversationSync)

- [ ] **Step 1: Remove the tier gate from conversations handler**

In `backend/src/api/conversations.ts`, find the `requireConversationSync(c)` or `requirePlus(c, ...)` calls at the top of POST `/`, GET `/`, and other conversation endpoints. Remove them so conversations are available to all tiers.

The function is called `requireConversationSync` in the conversations handler — it wraps `requirePlus`. Remove every call to `requireConversationSync(c)` in the file.

- [ ] **Step 2: Remove the requireConversationSync function**

In `backend/src/lib/tier.ts`, delete the `requireConversationSync` function entirely. It's no longer needed.

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `cd backend && npm test`
Expected: All existing tests pass. Conversations are now accessible to free tier users.

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/conversations.ts backend/src/lib/tier.ts
git commit -m "feat: lift conversations to free tier"
```

---

### Task 2: Backend — Add Quota Middleware

**Files:**
- Modify: `backend/src/lib/tier.ts` (add checkProjectQuota, checkPullQuota)
- Modify: `backend/src/lib/constants.ts` (add quota constants)
- Modify: `backend/src/api/projects.ts` (add project count check on create)
- Modify: `backend/src/api/context.ts` (add pull count check on search)

- [ ] **Step 1: Add quota constants**

In `backend/src/lib/constants.ts`, add:

```typescript
export const FREE_MAX_PROJECTS = 5;
export const PLUS_MAX_PROJECTS = 50;
export const FREE_MAX_PULLS_PER_DAY = 50;
```

- [ ] **Step 2: Add quota check functions to tier.ts**

In `backend/src/lib/tier.ts`, add two functions:

```typescript
import { FREE_MAX_PROJECTS, PLUS_MAX_PROJECTS, FREE_MAX_PULLS_PER_DAY } from "./constants";

export function enforceProjectQuota(currentCount: number, c: Context) {
  const tier = c.get("tier") ?? "free";
  const max = tier === "plus" ? PLUS_MAX_PROJECTS : FREE_MAX_PROJECTS;
  if (currentCount >= max) {
    throw new ForbiddenError(
      `Project limit reached (${max}). ${tier === "free" ? "Upgrade to Plus for up to 50 projects." : "Maximum 50 projects on Plus."}`,
    );
  }
}

export function enforcePullQuota(pullCount: number, c: Context) {
  const tier = c.get("tier") ?? "free";
  if (tier === "plus") return; // unlimited
  if (pullCount >= FREE_MAX_PULLS_PER_DAY) {
    throw new ForbiddenError(
      `Daily context pull limit reached (${FREE_MAX_PULLS_PER_DAY}). Upgrade to Plus for unlimited pulls.`,
    );
  }
}
```

- [ ] **Step 3: Wire project quota into POST /api/projects**

In `backend/src/api/projects.ts`, in the POST `/` handler, after auth but before creating the project, count existing projects and call `enforceProjectQuota`:

```typescript
const projects = await listUserProjects(db, user.id);
enforceProjectQuota(projects.length, c);
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/constants.ts backend/src/lib/tier.ts backend/src/api/projects.ts
git commit -m "feat: add usage quota middleware for projects and pulls"
```

---

### Task 3: Backend — Add Project Stats to List Endpoint

The home page needs conversation count, insight count, and tool badges per project. Rather than N+1 queries from the frontend, add stats to the projects list response.

**Files:**
- Modify: `backend/src/api/projects.ts` (enrich project list with stats)
- Modify: `backend/src/db/queries/projects.ts` (add stats query)

- [ ] **Step 1: Add a project stats query**

In `backend/src/db/queries/projects.ts`, add:

```typescript
export async function getProjectStats(db: SupabaseClient, projectId: string) {
  const [convResult, insightResult] = await Promise.all([
    db
      .from("conversations")
      .select("id, metadata", { count: "exact", head: false })
      .eq("project_id", projectId)
      .neq("status", "deleted"),
    db
      .from("insights")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  // Extract unique source_agents from conversation metadata
  const tools: string[] = [];
  if (convResult.data) {
    const toolSet = new Set<string>();
    for (const c of convResult.data) {
      const agent = (c.metadata as Record<string, unknown>)?.source_agent;
      if (typeof agent === "string") toolSet.add(agent);
    }
    tools.push(...toolSet);
  }

  return {
    conversation_count: convResult.count ?? 0,
    insight_count: insightResult.count ?? 0,
    tools,
  };
}
```

- [ ] **Step 2: Enrich the GET /api/projects response**

In `backend/src/api/projects.ts`, in the GET `/` handler, after fetching projects, enrich each with stats:

```typescript
const enriched = await Promise.all(
  projects.map(async (p) => {
    const stats = await getProjectStats(db, p.id);
    return { ...p, ...stats };
  }),
);
return c.json(enriched);
```

- [ ] **Step 3: Run tests**

Run: `cd backend && npm test`
Expected: All tests pass. The response now includes `conversation_count`, `insight_count`, and `tools` on each project.

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/projects.ts backend/src/db/queries/projects.ts
git commit -m "feat: add conversation/insight stats to projects list"
```

---

### Task 4: Frontend — Update Sidebar for New Navigation

**Files:**
- Modify: `frontend/src/lib/components/layout/Sidebar.svelte`

- [ ] **Step 1: Replace the nav sections**

Replace the entire `navSections` derived in `Sidebar.svelte` with:

```typescript
const navSections = $derived([
  {
    items: [
      { href: `/projects/${encodeURIComponent(projectName)}`, label: "Overview", icon: "📋", exact: true },
      { href: `/projects/${encodeURIComponent(projectName)}/conversations`, label: "Conversations", icon: "💬" },
      { href: `/projects/${encodeURIComponent(projectName)}/context`, label: "Context", icon: "🧠" },
      { href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings", icon: "⚙️" },
    ],
  },
]);
```

- [ ] **Step 2: Remove the section heading rendering**

In the template, remove the `{section.heading}` heading div since we no longer have section groupings. Update the `{#each}` to skip the heading:

```svelte
<nav class="sidebar">
  {#each navSections as section}
    <div class="sidebar-section">
      {#each section.items as link}
        {@const isActive = link.exact
          ? $page.url.pathname === link.href
          : $page.url.pathname.startsWith(link.href)}
        <a href={link.href} class="sidebar-item" class:active={isActive}>
          <span class="item-icon">{link.icon}</span>
          <span class="item-text">{link.label}</span>
        </a>
      {/each}
    </div>
  {/each}
</nav>
```

- [ ] **Step 3: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to any project page. The sidebar should show: Overview, Conversations, Context, Settings.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/components/layout/Sidebar.svelte
git commit -m "feat: update sidebar nav for conversations-first layout"
```

---

### Task 5: Frontend — Update Types for Project Stats

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add stats fields to Project interface**

In `frontend/src/lib/types.ts`, add the stats fields to the `Project` interface:

```typescript
export interface Project {
  id: string;
  name: string;
  owner_id: string;
  owner_email?: string;
  role?: string;
  google_drive_folder_id: string | null;
  created_at: string;
  project_members?: ProjectMember[];
  // Stats (enriched by backend)
  conversation_count?: number;
  insight_count?: number;
  tools?: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add project stats fields to frontend types"
```

---

### Task 6: Frontend — Build Home Page

This replaces the `/dashboard` redirect with an actual home page showing the project grid and inbox.

**Files:**
- Create: `frontend/src/routes/(app)/+page.svelte`
- Create: `frontend/src/routes/(app)/+page.server.ts`
- Modify: `frontend/src/routes/(app)/dashboard/+page.server.ts` (redirect to /)

- [ ] **Step 1: Create the home page server loader**

Create `frontend/src/routes/(app)/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import type { PageServerLoad, Actions } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);

  const [projects, billing] = await Promise.all([
    api.listProjects().catch(() => []),
    api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null })),
  ]);

  return { projects, tier: billing.tier };
};

export const actions: Actions = {
  createProject: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Project name is required" };
    try {
      await api.createProject(name);
      return { created: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create project" };
    }
  },
};
```

- [ ] **Step 2: Create the home page component**

Create `frontend/src/routes/(app)/+page.svelte`:

```svelte
<script lang="ts">
  import type { Project } from "$lib/types";

  let { data } = $props();

  let showNewProject = $state(false);
  let newProjectName = $state("");

  function projectSlug(p: Project): string {
    return p.role === "owner" ? p.name : `${p.owner_email}~${p.name}`;
  }

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  }

  const toolColors: Record<string, string> = {
    "claude-code": "tool-claude",
    claude: "tool-claude",
    cursor: "tool-cursor",
    gemini: "tool-gemini",
    chatgpt: "tool-chatgpt",
    "claude.ai": "tool-claudeai",
    copilot: "tool-copilot",
    codex: "tool-codex",
    cline: "tool-cline",
    "roo-code": "tool-roo",
  };
</script>

<div class="home">
  <div class="page-header">
    <h1 class="page-title">Your Projects</h1>
    <button class="btn-primary" onclick={() => showNewProject = !showNewProject}>
      + New Project
    </button>
  </div>

  {#if showNewProject}
    <form method="POST" action="?/createProject" class="new-project-form glass">
      <input
        type="text"
        name="name"
        bind:value={newProjectName}
        placeholder="Project name"
        class="input"
      />
      <button type="submit" class="btn-primary" disabled={!newProjectName.trim()}>Create</button>
    </form>
  {/if}

  <div class="project-grid">
    {#each data.projects as project}
      <a href="/projects/{encodeURIComponent(projectSlug(project))}" class="project-card glass">
        <div class="card-header">
          <span class="card-name">{project.name}</span>
          <span class="card-time">{relativeTime(project.created_at)}</span>
        </div>
        <div class="card-stats">
          {project.conversation_count ?? 0} conversations &middot; {project.insight_count ?? 0} insights
        </div>
        <div class="card-tools">
          {#each project.tools ?? [] as tool}
            <span class="tool-badge {toolColors[tool] ?? 'tool-default'}">{tool}</span>
          {/each}
        </div>
      </a>
    {/each}
  </div>

  {#if data.projects.length === 0}
    <div class="empty-state glass">
      <p>No projects yet. Create one to get started.</p>
    </div>
  {/if}

  <div class="usage-bar">
    <div class="usage-stats">
      <span>Projects: <strong>{data.projects.length} / {data.tier === "plus" ? 50 : 5}</strong></span>
    </div>
    {#if data.tier === "free"}
      <a href="/settings" class="usage-upgrade">Upgrade to Plus &rarr;</a>
    {/if}
  </div>
</div>

<style>
  .home {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .page-title {
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .btn-primary {
    background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink));
    color: white;
    border: none;
    border-radius: 9999px;
    padding: 10px 22px;
    font-weight: 600;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: all 150ms ease;
  }
  .btn-primary:hover { transform: scale(1.03); box-shadow: 0 8px 32px rgba(109, 41, 50, 0.35); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .new-project-form {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .input {
    flex: 1;
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--color-bg-muted);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-family: inherit;
    font-size: 13px;
  }
  .input:focus { outline: none; border-color: var(--color-pink); box-shadow: 0 0 0 3px rgba(109, 41, 50, 0.1); }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .project-card {
    padding: 1.25rem;
    cursor: pointer;
    transition: all 150ms ease;
    text-decoration: none;
    color: inherit;
    display: block;
  }
  .project-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .card-name { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
  .card-time { font-size: 11px; color: var(--color-text-muted); background: var(--color-bg-muted); padding: 2px 8px; border-radius: 4px; }

  .card-stats { font-size: 13px; color: var(--color-text-muted); margin-bottom: 0.75rem; }

  .card-tools { display: flex; gap: 6px; flex-wrap: wrap; }

  .tool-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
  :global(.tool-claude) { background: rgba(86, 28, 36, 0.1); color: var(--color-pink); }
  :global(.tool-cursor) { background: rgba(60, 80, 160, 0.1); color: #4a5eaa; }
  :global(.tool-gemini) { background: rgba(45, 80, 22, 0.1); color: var(--color-success); }
  :global(.tool-chatgpt) { background: rgba(16, 163, 127, 0.12); color: #0d8a6f; }
  :global(.tool-claudeai) { background: rgba(86, 28, 36, 0.08); color: #8a4a52; }
  :global(.tool-default) { background: var(--color-bg-muted); color: var(--color-text-muted); }

  .empty-state { padding: 2rem; text-align: center; color: var(--color-text-muted); }

  .usage-bar {
    background: rgba(255, 253, 248, 0.5);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(199, 183, 163, 0.25);
    border-radius: 12px;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .usage-stats { display: flex; gap: 1.5rem; font-size: 12px; color: var(--color-text-muted); }
  .usage-stats strong { color: var(--color-text); font-weight: 600; }
  .usage-upgrade { font-size: 12px; font-weight: 600; color: var(--color-link); text-decoration: none; }
</style>
```

- [ ] **Step 3: Update dashboard to redirect to /**

Replace the content of `frontend/src/routes/(app)/dashboard/+page.server.ts`:

```typescript
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  redirect(303, "/");
};
```

- [ ] **Step 4: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to `/`. Should see project grid with stats and tool badges.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/\(app\)/+page.svelte frontend/src/routes/\(app\)/+page.server.ts frontend/src/routes/\(app\)/dashboard/+page.server.ts
git commit -m "feat: build home page with project grid and usage bar"
```

---

### Task 7: Frontend — Rebuild Project Overview Page

Replace the file browser/editor with insights + recent conversations.

**Files:**
- Rewrite: `frontend/src/routes/(app)/projects/[name]/+page.svelte`
- Rewrite: `frontend/src/routes/(app)/projects/[name]/+page.server.ts`
- Modify: `frontend/src/routes/(app)/projects/[name]/+layout.server.ts` (simplify — remove entries/shareLinks/activity)

- [ ] **Step 1: Simplify the project layout loader**

Rewrite `frontend/src/routes/(app)/projects/[name]/+layout.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
  depends("app:project");

  const api = createApi(locals.token);
  const projects = await api.listProjects();

  const decodedName = decodeURIComponent(params.name);
  let project = projects.find((p) => p.name === decodedName);
  if (!project && decodedName.includes("~")) {
    const [ownerEmail, name] = decodedName.split("~");
    project = projects.find((p) => p.name === name && p.owner_email === ownerEmail);
  }
  if (!project) error(404, "Project not found");

  return { project };
};
```

- [ ] **Step 2: Create the project overview server loader**

Rewrite `frontend/src/routes/(app)/projects/[name]/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const [insightsResult, conversationsResult] = await Promise.all([
    api.listInsights(project.id, undefined, 8, 0).catch(() => ({ insights: [], total: 0 })),
    api.listConversations(project.id, "active", 5, 0).catch(() => ({ conversations: [], total: 0 })),
  ]);

  return {
    insights: insightsResult.insights,
    insightTotal: insightsResult.total,
    conversations: conversationsResult.conversations,
    conversationTotal: conversationsResult.total,
  };
};
```

- [ ] **Step 3: Create the project overview component**

Rewrite `frontend/src/routes/(app)/projects/[name]/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const projectSlug = encodeURIComponent(data.project.name);

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
</script>

<div class="overview">
  <h2 class="section-title">Insights ({data.insightTotal})</h2>

  {#if data.insights.length === 0}
    <p class="empty">No insights yet. They'll appear here as conversations are analyzed.</p>
  {:else}
    <div class="insight-list">
      {#each data.insights as insight}
        <div class="insight-item">
          <div class="insight-text">{insight.summary}</div>
        </div>
      {/each}
    </div>
    {#if data.insightTotal > data.insights.length}
      <a href="/projects/{projectSlug}/insights" class="show-all">Show all {data.insightTotal} &rarr;</a>
    {/if}
  {/if}

  <hr class="divider" />

  <h2 class="section-title">Recent Conversations</h2>

  {#if data.conversations.length === 0}
    <p class="empty">No conversations yet. Start using AI tools and they'll appear here automatically.</p>
  {:else}
    <div class="convo-list">
      {#each data.conversations as convo}
        <a href="/projects/{projectSlug}/conversations/{convo.id}" class="convo-item">
          <div class="convo-header">
            <span class="convo-title">{convo.title ?? "Untitled conversation"}</span>
            <span class="convo-time">{relativeTime(convo.updated_at)}</span>
          </div>
          <div class="convo-meta">{convo.message_count} messages</div>
        </a>
      {/each}
    </div>
    {#if data.conversationTotal > data.conversations.length}
      <a href="/projects/{projectSlug}/conversations" class="show-all">View all conversations &rarr;</a>
    {/if}
  {/if}
</div>

<style>
  .overview { padding: 1.5rem; }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 0.75rem;
    letter-spacing: -0.02em;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 1.5rem 0;
  }

  .empty { font-size: 13px; color: var(--color-text-muted); }

  .insight-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .insight-item {
    padding: 0.75rem 1rem;
    border-radius: 12px;
    background: rgba(255, 253, 248, 0.5);
    border: 1px solid rgba(199, 183, 163, 0.25);
  }
  .insight-text { font-size: 13px; line-height: 1.5; }

  .convo-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .convo-item {
    display: block;
    padding: 1rem;
    border-radius: 12px;
    background: rgba(255, 253, 248, 0.5);
    border: 1px solid rgba(199, 183, 163, 0.25);
    text-decoration: none;
    color: inherit;
    transition: all 150ms ease;
  }
  .convo-item:hover {
    background: rgba(255, 253, 248, 0.8);
    border-color: var(--color-border);
    transform: translateY(-1px);
  }
  .convo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }
  .convo-title { font-size: 14px; font-weight: 600; }
  .convo-time { font-size: 11px; color: var(--color-text-muted); }
  .convo-meta { font-size: 12px; color: var(--color-text-muted); }

  .show-all {
    font-size: 13px;
    color: var(--color-link);
    font-weight: 600;
    text-decoration: none;
    display: inline-block;
    margin-top: 0.5rem;
  }
</style>
```

- [ ] **Step 4: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to `/projects/[name]`. Should show insights + recent conversations instead of the file browser.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/\(app\)/projects/\[name\]/+layout.server.ts frontend/src/routes/\(app\)/projects/\[name\]/+page.server.ts frontend/src/routes/\(app\)/projects/\[name\]/+page.svelte
git commit -m "feat: rebuild project overview with insights and recent conversations"
```

---

### Task 8: Frontend — Update Conversations List Page

Remove the tier gate, add tool filter tabs.

**Files:**
- Rewrite: `frontend/src/routes/(app)/projects/[name]/conversations/+page.server.ts`
- Rewrite: `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte`

- [ ] **Step 1: Update the server loader to remove tier gate**

Rewrite `frontend/src/routes/(app)/projects/[name]/conversations/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const statusFilter = url.searchParams.get("status") || "all";
  const offset = (page - 1) * PAGE_SIZE;

  const { conversations, total } = await api.listConversations(
    project.id,
    statusFilter !== "all" ? statusFilter : undefined,
    PAGE_SIZE,
    offset,
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return { conversations, total, page, totalPages, statusFilter };
};
```

- [ ] **Step 2: Rewrite the conversations list component**

Rewrite `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  const projectSlug = encodeURIComponent(data.project.name);

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
</script>

<div class="conversations-page">
  <div class="convo-list">
    {#each data.conversations as convo}
      <a href="/projects/{projectSlug}/conversations/{convo.id}" class="convo-item">
        <div class="convo-header">
          <span class="convo-title">{convo.title ?? "Untitled conversation"}</span>
          <span class="convo-time">{relativeTime(convo.updated_at)}</span>
        </div>
        <div class="convo-meta">{convo.message_count} messages</div>
      </a>
    {:else}
      <p class="empty">No conversations yet.</p>
    {/each}
  </div>

  {#if data.totalPages > 1}
    <div class="pagination">
      {#if data.page > 1}
        <a href="?page={data.page - 1}" class="page-link">&larr; Previous</a>
      {/if}
      <span class="page-info">Page {data.page} of {data.totalPages}</span>
      {#if data.page < data.totalPages}
        <a href="?page={data.page + 1}" class="page-link">Next &rarr;</a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .conversations-page { padding: 1.5rem; }

  .convo-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .convo-item {
    display: block;
    padding: 1rem;
    border-radius: 12px;
    background: rgba(255, 253, 248, 0.5);
    border: 1px solid rgba(199, 183, 163, 0.25);
    text-decoration: none;
    color: inherit;
    transition: all 150ms ease;
  }
  .convo-item:hover {
    background: rgba(255, 253, 248, 0.8);
    border-color: var(--color-border);
    transform: translateY(-1px);
  }
  .convo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }
  .convo-title { font-size: 14px; font-weight: 600; }
  .convo-time { font-size: 11px; color: var(--color-text-muted); }
  .convo-meta { font-size: 12px; color: var(--color-text-muted); }

  .empty { font-size: 13px; color: var(--color-text-muted); }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-top: 1.5rem;
    font-size: 13px;
  }
  .page-link { color: var(--color-link); font-weight: 600; text-decoration: none; }
  .page-info { color: var(--color-text-muted); }
</style>
```

- [ ] **Step 3: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to `/projects/[name]/conversations`. Should show all conversations without tier gate.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/\(app\)/projects/\[name\]/conversations/+page.server.ts frontend/src/routes/\(app\)/projects/\[name\]/conversations/+page.svelte
git commit -m "feat: rebuild conversations list, remove tier gate"
```

---

### Task 9: Frontend — Rebuild Conversation Detail with Compact/Full Toggle

**Files:**
- Rewrite: `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte`
- Keep: `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.server.ts` (mostly unchanged)
- Keep: `frontend/src/routes/(app)/projects/[name]/conversations/[id]/api/+server.ts` (unchanged)

- [ ] **Step 1: Rewrite the conversation detail component**

Rewrite `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import type { ConversationMessage } from "$lib/types";

  let { data } = $props();

  const projectSlug = encodeURIComponent(data.project.name);

  let loading = $state(true);
  let conv = $state<Record<string, unknown> | null>(null);
  let messages = $state<ConversationMessage[]>([]);
  let viewMode = $state<"compact" | "full">("full");

  $effect(() => {
    loadConversation();
  });

  async function loadConversation() {
    loading = true;
    try {
      const res = await fetch(`/projects/${projectSlug}/conversations/${data.conversationId}/api`);
      const result = await res.json();
      conv = result.conversation;
      messages = result.messages ?? [];
    } catch {
      conv = null;
      messages = [];
    }
    loading = false;
  }

  function formatRole(msg: ConversationMessage): string {
    if (msg.role === "user") return "You";
    if (msg.role === "assistant") return msg.source_agent || "Assistant";
    return msg.role;
  }

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }

  const totalTokens = $derived(
    messages.reduce((sum, m) => sum + (m.token_count?.input ?? 0) + (m.token_count?.output ?? 0), 0),
  );
</script>

<div class="detail-page">
  {#if loading}
    <div class="loading">Loading conversation...</div>
  {:else if conv}
    <div class="detail-header">
      <h1 class="detail-title">{conv.title ?? "Untitled conversation"}</h1>
      <div class="detail-meta">
        {messages.length} messages
        {#if totalTokens > 0}&middot; ~{Math.round(totalTokens / 1000)}k tokens{/if}
        &middot; {relativeTime(String(conv.updated_at))}
      </div>
    </div>

    <div class="view-toggle">
      <button
        class="toggle-btn"
        class:active={viewMode === "compact"}
        onclick={() => viewMode = "compact"}
      >Compact</button>
      <button
        class="toggle-btn"
        class:active={viewMode === "full"}
        onclick={() => viewMode = "full"}
      >Full transcript</button>
    </div>

    {#if viewMode === "compact"}
      <div class="compact-view glass">
        <p class="compact-placeholder">
          Compact summaries will appear here once compaction is enabled.
          For now, switch to "Full transcript" to view the conversation.
        </p>
      </div>
    {:else}
      <div class="transcript glass">
        {#each messages as msg}
          <div class="chat-msg">
            <div class="chat-avatar" class:user={msg.role === "user"} class:assistant={msg.role === "assistant"}>
              {msg.role === "user" ? "Y" : "A"}
            </div>
            <div class="chat-bubble">
              <div class="chat-role">{formatRole(msg)}</div>
              {#if msg.content}
                <div class="chat-text">{msg.content}</div>
              {/if}
              {#if msg.tool_interaction}
                <div class="tool-call">
                  <span class="tool-name">{msg.tool_interaction.name}</span>
                  {#if msg.tool_interaction.summary}
                    <span class="tool-summary">{msg.tool_interaction.summary}</span>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="convo-footer">
      <span>Messages: {messages.length}</span>
      {#if totalTokens > 0}<span>Tokens: ~{Math.round(totalTokens / 1000)}k</span>{/if}
    </div>
  {:else}
    <p class="empty">Conversation not found.</p>
  {/if}
</div>

<style>
  .detail-page { padding: 1.5rem; }

  .loading { font-size: 13px; color: var(--color-text-muted); padding: 2rem; text-align: center; }
  .empty { font-size: 13px; color: var(--color-text-muted); }

  .detail-header { margin-bottom: 1rem; }
  .detail-title { font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
  .detail-meta { font-size: 13px; color: var(--color-text-muted); }

  .view-toggle { display: flex; gap: 0; margin-bottom: 1rem; }
  .toggle-btn {
    font-size: 13px; font-weight: 600; font-family: inherit;
    padding: 8px 20px; cursor: pointer;
    border: 1px solid var(--color-border);
    background: rgba(255, 253, 248, 0.4);
    color: var(--color-text-muted);
    transition: all 150ms ease;
  }
  .toggle-btn:first-child { border-radius: 8px 0 0 8px; }
  .toggle-btn:last-child { border-radius: 0 8px 8px 0; border-left: none; }
  .toggle-btn.active { background: rgba(86, 28, 36, 0.08); color: var(--color-text); border-color: rgba(86, 28, 36, 0.2); }

  .compact-view { padding: 1.5rem; }
  .compact-placeholder { font-size: 13px; color: var(--color-text-muted); font-style: italic; }

  .transcript { padding: 1.25rem; max-height: 70vh; overflow-y: auto; }

  .chat-msg { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
  .chat-avatar {
    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700;
  }
  .chat-avatar.user { background: linear-gradient(135deg, #e8d8c4, #c7b7a3); color: var(--color-pink-dark); }
  .chat-avatar.assistant { background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink)); color: white; }
  .chat-bubble { flex: 1; min-width: 0; }
  .chat-role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); margin-bottom: 0.2rem; }
  .chat-text { font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }

  .tool-call {
    font-size: 12px;
    padding: 0.5rem 0.75rem;
    background: var(--color-bg-muted);
    border-radius: 8px;
    margin-top: 0.35rem;
  }
  .tool-name { font-weight: 600; color: var(--color-pink); }
  .tool-summary { color: var(--color-text-muted); margin-left: 0.5rem; }

  .convo-footer {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: var(--color-bg-muted);
    border-radius: 12px;
    font-size: 12px;
    color: var(--color-text-muted);
    display: flex;
    gap: 1.5rem;
  }
</style>
```

- [ ] **Step 2: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to a conversation. Should see the compact/full toggle. Full transcript shows chat bubbles.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/\(app\)/projects/\[name\]/conversations/\[id\]/+page.svelte
git commit -m "feat: rebuild conversation detail with compact/full toggle"
```

---

### Task 10: Frontend — Build Project Context Page

**Files:**
- Create: `frontend/src/routes/(app)/projects/[name]/context/+page.svelte`
- Create: `frontend/src/routes/(app)/projects/[name]/context/+page.server.ts`

- [ ] **Step 1: Create the context page server loader**

Create `frontend/src/routes/(app)/projects/[name]/context/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const billing = await api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null }));
  const { conversations, total } = await api.listConversations(project.id, undefined, 1, 0).catch(() => ({ conversations: [], total: 0 }));

  return {
    tier: billing.tier,
    conversationCount: total,
  };
};
```

- [ ] **Step 2: Create the context page component**

Create `frontend/src/routes/(app)/projects/[name]/context/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();
</script>

<div class="context-page">
  <h2 class="section-title">Project Context</h2>
  <p class="subtitle">
    {#if data.conversationCount > 0}
      Generated from {data.conversationCount} conversations
    {:else}
      No conversations yet
    {/if}
  </p>

  {#if data.tier === "free"}
    <div class="upgrade-prompt glass">
      <p>Project context summaries are generated automatically on the <strong>Plus</strong> plan.</p>
      <p>Your conversations and insights are still browsable on the free tier.</p>
      <a href="/settings" class="btn-secondary">Upgrade to Plus</a>
    </div>
  {:else}
    <div class="context-block glass">
      <p class="placeholder">
        Project context will appear here once compaction is enabled.
        This is what agents receive when they call <code>get_context("{data.project.name}")</code>.
      </p>
    </div>
  {/if}
</div>

<style>
  .context-page { padding: 1.5rem; }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 0.25rem;
  }

  .subtitle {
    font-size: 13px;
    color: var(--color-text-muted);
    margin-bottom: 1rem;
  }

  .upgrade-prompt {
    padding: 1.5rem;
    text-align: center;
    font-size: 14px;
    line-height: 1.7;
  }
  .upgrade-prompt p { margin-bottom: 0.75rem; }

  .btn-secondary {
    display: inline-block;
    background: rgba(86, 28, 36, 0.06);
    color: var(--color-pink-dark);
    border: 1px solid var(--color-pink);
    border-radius: 9999px;
    padding: 8px 18px;
    font-weight: 500;
    font-size: 13px;
    text-decoration: none;
    transition: all 150ms ease;
  }
  .btn-secondary:hover { background: rgba(86, 28, 36, 0.1); }

  .context-block { padding: 1.5rem; }
  .placeholder { font-size: 13px; color: var(--color-text-muted); font-style: italic; }
  .placeholder code {
    font-family: monospace;
    font-size: 12px;
    background: var(--color-bg-muted);
    padding: 0.15em 0.4em;
    border-radius: 4px;
  }
</style>
```

- [ ] **Step 3: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to `/projects/[name]/context`. Free tier shows upgrade prompt, Plus shows placeholder.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/\(app\)/projects/\[name\]/context/
git commit -m "feat: add project context page with tier-based display"
```

---

### Task 11: Frontend — Build Settings Page

**Files:**
- Create: `frontend/src/routes/(app)/settings/+page.svelte`
- Create: `frontend/src/routes/(app)/settings/+page.server.ts`

- [ ] **Step 1: Create the settings page server loader**

Create `frontend/src/routes/(app)/settings/+page.server.ts`:

```typescript
import { createApi } from "$lib/server/api";
import type { PageServerLoad, Actions } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);

  const [billing, keys, projects] = await Promise.all([
    api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null })),
    api.listApiKeys().catch(() => []),
    api.listProjects().catch(() => []),
  ]);

  return {
    tier: billing.tier,
    subscription: billing.subscription,
    apiKeys: keys,
    projectCount: projects.length,
  };
};

export const actions: Actions = {
  createKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const form = await request.formData();
    const label = String(form.get("label") || "").trim();
    if (!label) return { error: "Label is required" };
    const result = await api.createApiKey(label);
    return { newKey: result.api_key, label: result.label };
  },
  revokeKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const form = await request.formData();
    const keyId = String(form.get("keyId"));
    await api.revokeApiKey(keyId);
    return { revoked: true };
  },
  checkout: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createCheckout();
    return { checkoutUrl: url };
  },
};
```

- [ ] **Step 2: Create the settings page component**

Create `frontend/src/routes/(app)/settings/+page.svelte`:

```svelte
<script lang="ts">
  let { data, form } = $props();

  let showNewKey = $state(false);
  let newKeyLabel = $state("");

  const maxProjects = data.tier === "plus" ? 50 : 5;
</script>

<div class="settings">
  <h1 class="page-title">Settings</h1>

  <div class="settings-grid">
    <!-- Plan -->
    <div class="glass section">
      <h2 class="section-title">Plan</h2>
      <div class="setting-row">
        <span class="label">Current plan</span>
        <span class="value">{data.tier === "plus" ? "Plus" : "Free"}</span>
      </div>
      <div class="setting-row">
        <span class="label">Projects</span>
        <div class="value-with-bar">
          <span class="value">{data.projectCount} / {maxProjects}</span>
          <div class="progress-bg">
            <div class="progress-fill" style="width: {Math.min(100, (data.projectCount / maxProjects) * 100)}%"></div>
          </div>
        </div>
      </div>
      {#if data.tier === "free"}
        <form method="POST" action="?/checkout" style="margin-top: 1rem;">
          <button type="submit" class="btn-primary">Upgrade to Plus &mdash; $9/mo</button>
        </form>
      {:else if data.subscription}
        <div class="setting-row" style="margin-top: 0.5rem;">
          <span class="label">Status</span>
          <span class="value green">{data.subscription.status}</span>
        </div>
      {/if}
    </div>

    <!-- API Keys -->
    <div class="glass section">
      <h2 class="section-title">API Keys</h2>
      {#each data.apiKeys as key}
        <div class="key-row">
          <span class="key-name">{key.label}</span>
          <div class="key-actions">
            <span class="key-status">Active</span>
            <form method="POST" action="?/revokeKey" style="display:inline;">
              <input type="hidden" name="keyId" value={key.id} />
              <button type="submit" class="revoke-btn">Revoke</button>
            </form>
          </div>
        </div>
      {/each}
      {#if showNewKey}
        <form method="POST" action="?/createKey" class="new-key-form">
          <input type="text" name="label" bind:value={newKeyLabel} placeholder="Key label" class="input" />
          <button type="submit" class="btn-primary" disabled={!newKeyLabel.trim()}>Create</button>
        </form>
      {/if}
      {#if form?.newKey}
        <div class="new-key-display">
          <p>New key created. Copy it now — it won't be shown again:</p>
          <code>{form.newKey}</code>
        </div>
      {/if}
      <button class="btn-secondary" style="margin-top: 0.75rem;" onclick={() => showNewKey = !showNewKey}>
        + New API Key
      </button>
    </div>
  </div>
</div>

<style>
  .settings { max-width: 640px; margin: 0 auto; padding: 2rem 1.5rem; }

  .page-title { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem; }

  .settings-grid { display: flex; flex-direction: column; gap: 1rem; }

  .section { padding: 1.25rem; }
  .section-title { font-size: 14px; font-weight: 700; margin-bottom: 0.75rem; letter-spacing: -0.02em; }

  .setting-row { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0; font-size: 13px; }
  .label { color: var(--color-text-muted); }
  .value { font-weight: 600; }
  .value.green { color: var(--color-success); }

  .value-with-bar { display: flex; align-items: center; gap: 10px; }
  .progress-bg { width: 120px; height: 6px; background: var(--color-bg-muted); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--color-pink-dark), var(--color-pink)); }

  .key-row { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid rgba(199, 183, 163, 0.2); font-size: 13px; }
  .key-name { font-weight: 600; }
  .key-actions { display: flex; align-items: center; gap: 12px; }
  .key-status { font-size: 12px; color: var(--color-success); font-weight: 600; }
  .revoke-btn { font-size: 12px; color: var(--color-danger); cursor: pointer; font-weight: 600; background: none; border: none; font-family: inherit; }

  .new-key-form { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .input { flex: 1; padding: 8px 12px; border-radius: 8px; background: var(--color-bg-muted); border: 1px solid var(--color-border); color: var(--color-text); font-family: inherit; font-size: 13px; }
  .input:focus { outline: none; border-color: var(--color-pink); }

  .new-key-display { margin-top: 0.75rem; padding: 0.75rem; background: var(--color-bg-muted); border-radius: 8px; font-size: 12px; }
  .new-key-display code { display: block; margin-top: 0.5rem; font-family: monospace; word-break: break-all; color: var(--color-pink); }

  .btn-primary {
    background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink));
    color: white; border: none; border-radius: 9999px; padding: 10px 22px;
    font-weight: 600; font-size: 13px; font-family: inherit; cursor: pointer;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: rgba(86, 28, 36, 0.06); color: var(--color-pink-dark);
    border: 1px solid var(--color-pink); border-radius: 9999px;
    padding: 8px 18px; font-weight: 500; font-size: 13px; font-family: inherit; cursor: pointer;
  }
</style>
```

- [ ] **Step 3: Verify visually**

Run: `cd frontend && npm run dev`
Navigate to `/settings`. Should show plan, API keys, and upgrade button.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/\(app\)/settings/
git commit -m "feat: build settings page with plan, API keys, usage"
```

---

### Task 12: Frontend — Remove Old Pages and Clean Up

**Files:**
- Delete: `frontend/src/routes/(app)/projects/[name]/activity/` (entire directory)
- Delete: `frontend/src/routes/(app)/projects/[name]/history/` (entire directory)
- Delete: `frontend/src/routes/(app)/projects/[name]/conversations/import/` (entire directory)
- Delete: `frontend/src/routes/(app)/projects/[name]/insights/` (entire directory — insights now shown on overview)
- Delete: `frontend/src/routes/(app)/projects/[name]/api/` (entry-related API routes)
- Delete: `frontend/src/lib/components/workspace/` (entire directory — file browser/editor components)
- Delete: `frontend/src/lib/components/activity/` (activity feed components)
- Delete: `frontend/src/lib/components/sharing/` (share link components — can add back later)

- [ ] **Step 1: Remove old route directories**

```bash
cd frontend
rm -rf src/routes/\(app\)/projects/\[name\]/activity
rm -rf src/routes/\(app\)/projects/\[name\]/history
rm -rf src/routes/\(app\)/projects/\[name\]/conversations/import
rm -rf src/routes/\(app\)/projects/\[name\]/insights
rm -rf src/routes/\(app\)/projects/\[name\]/api
```

- [ ] **Step 2: Remove old component directories**

```bash
cd frontend
rm -rf src/lib/components/workspace
rm -rf src/lib/components/activity
rm -rf src/lib/components/sharing
```

- [ ] **Step 3: Run typecheck to find broken imports**

Run: `cd frontend && npm run check`
Expected: Should pass. If there are broken imports referencing deleted files, fix them.

- [ ] **Step 4: Verify the app still works**

Run: `cd frontend && npm run dev`
Navigate through all 6 pages. Verify no 404s or broken links.

- [ ] **Step 5: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse
git add -A frontend/src/routes frontend/src/lib/components
git commit -m "chore: remove old filesystem pages and components"
```

---

### Task 13: Run Full Verify

- [ ] **Step 1: Run backend tests**

Run: `cd /Users/Tanmai.N/Documents/synapse && npm run verify`
Expected: lint, typecheck, and all tests pass.

- [ ] **Step 2: Fix any issues**

If typecheck fails due to removed imports or stale references, fix them.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve typecheck issues from frontend rebuild"
```
