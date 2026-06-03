# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Synapse dashboard to lead with an activity feed and session-centric navigation, reflecting the B+C product identity (session platform + distillation engine).

**Architecture:** Frontend-only changes across 4 Svelte components. No backend API, database, or route path changes. The existing data loaders and API endpoints are reused -- we're changing presentation and navigation order only.

**Tech Stack:** SvelteKit 5, Svelte 5 runes ($state, $derived, $props), existing CSS variable design system

---

## File Structure

```
frontend/src/lib/components/layout/
  Sidebar.svelte                — Modify: reorder navigation groups

frontend/src/routes/(app)/projects/[name]/
  activity/+page.svelte         — Rewrite: rich card timeline
  conversations/+page.svelte    — Modify: rename to Sessions, add tool filter tabs + badges
  insights/+page.svelte         — Modify: group by type with section headers

frontend/src/lib/components/layout/
  AppShell.svelte               — Modify: project name link → activity route
```

---

### Task 1: Sidebar Restructure

**Files:**
- Modify: `frontend/src/lib/components/layout/Sidebar.svelte`
- Modify: `frontend/src/lib/components/layout/AppShell.svelte`

- [ ] **Step 1: Update the sidebar navigation groups**

Replace the `navSections` derived in `Sidebar.svelte` (lines 6-25):

```svelte
const navSections = $derived([
  {
    heading: "Feed",
    items: [
      { href: `/projects/${encodeURIComponent(projectName)}/activity`, label: "Activity", icon: "📋" },
    ],
  },
  {
    heading: "Sessions",
    items: [
      { href: `/projects/${encodeURIComponent(projectName)}/conversations`, label: "Sessions", icon: "💬" },
    ],
  },
  {
    heading: "Knowledge",
    items: [
      { href: `/projects/${encodeURIComponent(projectName)}/insights`, label: "Insights", icon: "💡" },
      { href: `/projects/${encodeURIComponent(projectName)}`, label: "Workspace", icon: "📁", exact: true },
    ],
  },
  {
    heading: "Project",
    items: [
      { href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings", icon: "⚙️" },
    ],
  },
]);
```

- [ ] **Step 2: Update the project name link in AppShell to navigate to activity**

In `AppShell.svelte`, find the project name link in the header (line 55):

```svelte
<a href="/dashboard" class="flex items-center gap-2" style="color: white; font-size: 18px; font-weight: 800; text-decoration: none;">
```

This links to `/dashboard`. No change needed here -- the sidebar handles project-level navigation. But verify the sidebar's first item (Activity) is visually highlighted as the default when on `/projects/[name]/activity`.

The `isActive` logic on line 33-35 of Sidebar.svelte already handles this:
```svelte
{@const isActive = link.exact
  ? $page.url.pathname === link.href
  : $page.url.pathname.startsWith(link.href)}
```

Activity URL starts with `/projects/.../activity`, so it will match correctly. No code change needed.

- [ ] **Step 3: Verify the build**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npm run check`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/components/layout/Sidebar.svelte
git commit -m "feat(dashboard): reorder sidebar navigation for B+C identity"
```

---

### Task 2: Activity Feed Rewrite

**Files:**
- Modify: `frontend/src/routes/(app)/projects/[name]/activity/+page.svelte`

The current page renders a simple `ActivityFeed` component with flat entries. Rewrite it as a rich card timeline grouped by day, merging activity entries and conversation data (both available from the layout server load).

- [ ] **Step 1: Rewrite the activity page**

The parent layout at `+layout.server.ts` already loads `activity` (ActivityLogEntry[]) and the project. The conversations page loads conversations separately, but we can access activity data from the parent layout.

Replace the entire content of `frontend/src/routes/(app)/projects/[name]/activity/+page.svelte`:

```svelte
<script lang="ts">
  import type { ActivityLogEntry } from "$lib/types";

  let { data } = $props();

  interface FeedEvent {
    type: "captured" | "distilled" | "updated";
    timestamp: string;
    title: string;
    metadata: string;
    files?: { path: string; preview: string }[];
    link?: string;
    badge: string;
    badgeClass: string;
  }

  function buildFeed(activity: ActivityLogEntry[]): FeedEvent[] {
    return activity.map((entry) => {
      // Determine event type from action
      if (entry.action === "conversation_created" || entry.action === "conversation_synced") {
        return {
          type: "captured" as const,
          timestamp: entry.created_at,
          title: "Session synced",
          metadata: `${entry.source} · ${entry.target_path ?? "session"}`,
          badge: "CAPTURED",
          badgeClass: "badge-captured",
          link: entry.target_path ? undefined : undefined,
        };
      }

      if (entry.source === "distill") {
        return {
          type: "distilled" as const,
          timestamp: entry.created_at,
          title: "Knowledge extracted",
          metadata: `From ${entry.source} session`,
          files: entry.target_path
            ? [{ path: entry.target_path, preview: "" }]
            : [],
          badge: "DISTILLED",
          badgeClass: "badge-distilled",
        };
      }

      // Default: file updated
      return {
        type: "updated" as const,
        timestamp: entry.created_at,
        title: entry.action === "entry_created" ? "File created" : "File updated",
        metadata: entry.target_path ?? "",
        badge: "UPDATED",
        badgeClass: "badge-updated",
      };
    });
  }

  const feed = $derived(buildFeed(data.activity));

  // Group by day
  interface DayGroup {
    label: string;
    events: FeedEvent[];
  }

  function groupByDay(events: FeedEvent[]): DayGroup[] {
    const groups = new Map<string, FeedEvent[]>();
    const today = new Date().toLocaleDateString();
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();

    for (const event of events) {
      const dateStr = new Date(event.timestamp).toLocaleDateString();
      let label = dateStr;
      if (dateStr === today) label = "Today";
      else if (dateStr === yesterday) label = "Yesterday";

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(event);
    }

    return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
  }

  const dayGroups = $derived(groupByDay(feed));
</script>

<div class="feed-container">
  <h1 class="feed-title">Activity — {data.project.name}</h1>

  {#if dayGroups.length === 0}
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <p class="empty-title">No activity yet</p>
      <p class="empty-desc">
        Run <code>npx synapsesync-mcp capture start</code> to begin capturing sessions.
        Activity will appear here as sessions are captured and knowledge is extracted.
      </p>
    </div>
  {:else}
    {#each dayGroups as group}
      <div class="day-group">
        <div class="day-header">{group.label}</div>
        {#each group.events as event}
          <div class="event-card">
            <div class="event-header">
              <div class="event-header-left">
                <span class="event-badge {event.badgeClass}">{event.badge}</span>
                <span class="event-time">
                  {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
            <div class="event-title">{event.title}</div>
            <div class="event-metadata">{event.metadata}</div>
            {#if event.files && event.files.length > 0}
              <div class="event-files">
                {#each event.files as file}
                  <div class="event-file">
                    <span class="file-path">{file.path}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
  .feed-container {
    max-width: 680px;
    padding: 1.5rem;
  }

  .feed-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 1.5rem;
  }

  .day-group {
    margin-bottom: 1.5rem;
  }

  .day-header {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    padding-bottom: 0.75rem;
  }

  .event-card {
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.875rem;
    margin-bottom: 0.625rem;
    transition: box-shadow 0.15s ease;
  }

  .event-card:hover {
    box-shadow: 0 4px 16px rgba(86, 28, 36, 0.06);
  }

  .event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .event-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .event-badge {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.04em;
  }

  .badge-captured {
    background: rgba(200, 160, 106, 0.3);
    color: #8b6914;
  }

  .badge-distilled {
    background: #561c24;
    color: white;
  }

  .badge-updated {
    background: rgba(199, 183, 163, 0.3);
    color: var(--color-text-muted);
  }

  .event-time {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .event-title {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text);
    margin-bottom: 0.25rem;
  }

  .event-metadata {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .event-files {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.625rem;
  }

  .event-file {
    font-size: 0.6875rem;
    padding: 0.375rem 0.625rem;
    background: rgba(86, 28, 36, 0.04);
    border: 1px solid rgba(199, 183, 163, 0.25);
    border-radius: 6px;
  }

  .file-path {
    font-weight: 600;
    color: var(--color-accent);
    font-family: monospace;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 1rem;
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .empty-desc {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    max-width: 400px;
    margin: 0 auto;
    line-height: 1.6;
  }

  .empty-desc code {
    font-size: 0.75rem;
    background: rgba(86, 28, 36, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
  }
</style>
```

- [ ] **Step 2: Remove the +page.ts loader (no longer needed)**

The current `activity/+page.ts` just reads a page query param. The new feed uses data from the parent layout. Delete or empty the file:

```typescript
// frontend/src/routes/(app)/projects/[name]/activity/+page.ts
// No client-side load needed — data comes from parent layout
```

- [ ] **Step 3: Verify the build**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npm run check`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/activity/
git commit -m "feat(dashboard): rewrite activity feed as rich card timeline"
```

---

### Task 3: Sessions Page Rework

**Files:**
- Modify: `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte`

- [ ] **Step 1: Add tool filter tabs and badges to the conversations page**

The key changes:
1. Page title "Conversations" → "Sessions"
2. Add tool filter tabs above the list
3. Pass tool filter to the ConversationList or filter client-side

Replace the heading and filter area (lines 54-78 in the `:else` block) with:

In `conversations/+page.svelte`, replace the heading block:

```svelte
<h1 class="text-xl font-semibold" style="color: var(--color-accent);">
  Conversations
</h1>
```

With:

```svelte
<h1 class="text-xl font-semibold" style="color: var(--color-accent);">
  Sessions
</h1>
```

And add tool filter tabs after the header-actions div, before the `{#if filtering}` block. Add this state and derived to the script section after line 9:

```svelte
let toolFilter = $state("all");

const toolTabs = [
  { value: "all", label: "All" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

const filteredConversations = $derived(
  toolFilter === "all"
    ? data.conversations
    : data.conversations.filter(
        (c) => c.working_context?.tool === toolFilter,
      ),
);
```

Add the filter tabs markup between the header section and the ConversationList:

```svelte
<div class="tool-tabs">
  {#each toolTabs as tab}
    <button
      class="tool-tab"
      class:tool-tab-active={toolFilter === tab.value}
      onclick={() => (toolFilter = tab.value)}
    >
      {tab.label}
    </button>
  {/each}
</div>
```

Change the ConversationList to use `filteredConversations` instead of `data.conversations`:

```svelte
<ConversationList
  conversations={filteredConversations}
  projectName={data.project.name}
  {emptyLabel}
  {loadingConversationId}
/>
```

Add CSS at the end of the style block:

```css
.tool-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  padding: 0.25rem;
  background: var(--color-bg-muted);
  border-radius: 8px;
  width: fit-content;
}

.tool-tab {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.tool-tab:hover {
  color: var(--color-text);
  background: rgba(86, 28, 36, 0.04);
}

.tool-tab-active {
  background: var(--color-bg-raised);
  color: var(--color-accent);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
```

- [ ] **Step 2: Verify the build**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npm run check`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte
git commit -m "feat(dashboard): rework conversations page as Sessions with tool filter tabs"
```

---

### Task 4: Insights Page Grouping

**Files:**
- Modify: `frontend/src/routes/(app)/projects/[name]/insights/+page.svelte`

- [ ] **Step 1: Replace the flat InsightList with grouped sections**

In `insights/+page.svelte`, add grouping logic to the script section. After line 17 (the `insightTypes` array), add:

```svelte
interface InsightGroup {
  type: string;
  label: string;
  badgeClass: string;
  items: typeof data.insights;
}

const groups: InsightGroup[] = $derived([
  { type: "decision", label: "Decisions", badgeClass: "badge-decision", items: data.insights.filter((i) => i.type === "decision") },
  { type: "architecture", label: "Architecture", badgeClass: "badge-architecture", items: data.insights.filter((i) => i.type === "architecture") },
  { type: "learning", label: "Learnings", badgeClass: "badge-learning", items: data.insights.filter((i) => i.type === "learning") },
  { type: "preference", label: "Preferences", badgeClass: "badge-preference", items: data.insights.filter((i) => i.type === "preference") },
  { type: "action_item", label: "Action Items", badgeClass: "badge-action", items: data.insights.filter((i) => i.type === "action_item") },
]);

const nonEmptyGroups = $derived(groups.filter((g) => g.items.length > 0));
let collapsedSections = $state<Set<string>>(new Set());

function toggleSection(type: string) {
  const next = new Set(collapsedSections);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  collapsedSections = next;
}
```

Replace the `<InsightList insights={data.insights} />` line (line 103) with:

```svelte
{#if data.insights.length === 0}
  <div class="empty-state">
    <p class="empty-title">No insights yet</p>
    <p class="empty-desc">
      Insights are decisions, learnings, and preferences extracted from your sessions.
      Run <code>npx synapsesync-mcp distill --latest</code> or add one manually.
    </p>
  </div>
{:else}
  {#each nonEmptyGroups as group}
    <div class="insight-section">
      <button
        class="section-header"
        onclick={() => toggleSection(group.type)}
      >
        <div class="section-header-left">
          <span class="section-badge {group.badgeClass}">{group.label}</span>
          <span class="section-count">{group.items.length}</span>
        </div>
        <span class="section-chevron">
          {collapsedSections.has(group.type) ? "▶" : "▼"}
        </span>
      </button>
      {#if !collapsedSections.has(group.type)}
        <div class="section-items">
          <InsightList insights={group.items} />
        </div>
      {/if}
    </div>
  {/each}
{/if}
```

Add CSS at the end of the style block:

```css
.insight-section {
  margin-bottom: 1.5rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem 0;
  border: none;
  background: none;
  cursor: pointer;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.section-header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
}

.badge-decision {
  background: rgba(86, 28, 36, 0.08);
  color: #561c24;
}

.badge-architecture {
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
}

.badge-learning {
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
}

.badge-preference {
  background: rgba(168, 85, 247, 0.08);
  color: #7c3aed;
}

.badge-action {
  background: rgba(245, 158, 11, 0.08);
  color: #d97706;
}

.section-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.section-chevron {
  font-size: 0.625rem;
  color: var(--color-text-muted);
}

.section-items {
  padding-left: 0;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
}

.empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
}

.empty-desc {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  max-width: 400px;
  margin: 0 auto;
  line-height: 1.6;
}

.empty-desc code {
  font-size: 0.75rem;
  background: rgba(86, 28, 36, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}
```

- [ ] **Step 2: Verify the build**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npm run check`
Expected: 0 errors

- [ ] **Step 3: Run frontend tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npm run test`
Expected: All 140 tests pass

- [ ] **Step 4: Run full verify**

Run: `cd /Users/Tanmai.N/Documents/synapse && npm run verify`
Expected: All tests pass, lint clean, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/(app)/projects/[name]/insights/+page.svelte
git commit -m "feat(dashboard): group insights by type with collapsible sections and badges"
```
