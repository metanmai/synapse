# Dashboard Redesign: B+C Product Identity

**Date:** 2026-04-03
**Status:** Design approved
**Scope:** Frontend-only. No backend API, database, or route path changes.

---

## Overview

Rework the Synapse dashboard to reflect the B+C product identity (session platform + distillation engine). The current dashboard leads with a file browser (workspace). The new dashboard leads with an activity feed showing captured sessions and distilled knowledge.

All changes are presentation-layer: reordering navigation, reworking existing pages, and combining existing API data in new ways. The backend is untouched.

---

## Change 1: Sidebar Restructure

**File:** `frontend/src/lib/components/layout/Sidebar.svelte`

Current navigation:
```
Project:    Workspace (default), Settings
Knowledge:  Insights, Conversations
Activity:   Recent
```

New navigation:
```
Feed:       Activity (default)
Sessions:   Sessions
Knowledge:  Insights, Workspace
Project:    Settings
```

Changes:
- Activity becomes the first item and default landing view
- "Conversations" renamed to "Sessions" in the UI (route path stays `/conversations`)
- Workspace moves under Knowledge
- "Activity" group renamed to "Feed"
- Remove the separate "Recent" label -- Activity is the recent view

---

## Change 2: Activity Feed Page (Rewrite)

**File:** `frontend/src/routes/(app)/projects/[name]/activity/+page.svelte`

Rich card-based timeline grouped by day. Merges data from two existing API endpoints client-side:
- `GET /api/conversations?project_id=<id>` -- session events
- `GET /api/context/<project>/list` -- file events

### Event Types

| Event | Badge | Color | Data Source | Content |
|-------|-------|-------|-------------|---------|
| Session synced | `CAPTURED` | Amber (`rgba(200,160,106,0.3)` bg, `#8b6914` text) | Conversations API | Tool name, message count, status |
| Knowledge extracted | `DISTILLED` | Burgundy (`#561c24` bg, white text) | Context list API (source = "distill") | Source session reference, extracted file cards with path + first-line preview |
| File updated | `UPDATED` | Muted (`rgba(199,183,163,0.3)` bg) | Context list API (source != "distill") | File path, source label, update timestamp |

### Layout
- Day group headers: "Today", "Yesterday", or date string (e.g., "Mar 31")
- Each event is a card with: status badge, title, metadata line, and optional child content (file previews for distillation events)
- Cards are clickable: session cards → `/conversations/[id]`, file cards → workspace file view
- "Not yet distilled" label on captured sessions without corresponding distill files

### Data Merging
Fetch conversations and context list in parallel. Normalize into a unified event array:
```typescript
interface FeedEvent {
  type: "captured" | "distilled" | "updated";
  timestamp: string;
  title: string;
  metadata: string;
  files?: { path: string; preview: string }[];
  link?: string;
}
```
Sort by timestamp descending. Group by day using `toLocaleDateString()`.

### Empty State
"No activity yet. Run `npx synapsesync-mcp capture start` to begin capturing sessions."

---

## Change 3: Default Project Route

**File:** `frontend/src/routes/(app)/projects/[name]/+page.svelte`

Currently renders the workspace file browser. The workspace page stays at this route -- no changes to the page itself.

**What changes:** The sidebar highlights Activity as the first/default item instead of Workspace. The project name link in the header navbar navigates to `/projects/[name]/activity` instead of `/projects/[name]`. Users land on Activity from the sidebar. The workspace file browser is still one click away under Knowledge → Workspace.

---

## Change 4: Sessions Page Rework

**File:** `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte`

Currently shows a list of synced conversations. Rework to feel like a sessions view:

### Changes
- Page heading: "Conversations" → "Sessions"
- Add tool filter tabs at top: All | Claude Code | Cursor | Codex | Gemini
- Each session card shows:
  - Tool badge (colored by tool name)
  - Title (existing)
  - Message count and status (existing)
  - Distillation indicator: "Distilled · N files" or "Not distilled" (derived from conversation's `working_context.tool` field, if present)
  - Timestamp (existing)

### Tool Badges
| Tool | Background | Text |
|------|-----------|------|
| Claude Code | `rgba(86,28,36,0.08)` | `#561c24` |
| Cursor | `rgba(59,130,246,0.08)` | `#2563eb` |
| Codex | `rgba(16,185,129,0.08)` | `#059669` |
| Gemini | `rgba(168,85,247,0.08)` | `#7c3aed` |
| Other/Unknown | `rgba(107,114,128,0.08)` | `#6b7280` |

### Filtering
Client-side filter on the existing conversations array. The `working_context` object on each conversation may contain a `tool` field (set by the capture daemon when syncing). Filter by matching this field.

```typescript
let toolFilter = $state("all");
let filtered = $derived(
  toolFilter === "all"
    ? conversations
    : conversations.filter(c => c.working_context?.tool === toolFilter)
);
```

### Data Source
Existing `GET /api/conversations?project_id=<id>` endpoint. No changes needed. The `working_context` field already contains tool metadata from the capture sync.

---

## Change 5: Insights Page Rework

**File:** `frontend/src/routes/(app)/projects/[name]/insights/+page.svelte`

Currently shows a flat list of insights. Rework to group by type with section headers.

### Changes
- Group insights by `type` field: decision, architecture, learning, preference, action_item
- Section headers with counts: "Decisions (3)", "Architecture (2)", etc.
- Each insight card shows:
  - Type badge (same color scheme as tool badges but for types)
  - Summary (existing)
  - Detail text (existing, if present)
  - Source attribution line: "From [source_agent] · [date]"
  - Click to expand full detail
- Sections are collapsible (default: expanded if ≤ 5 items, collapsed if > 5)
- Empty sections show: "No [type] insights yet"
- Type-specific empty states are more helpful than one generic message

### Type Badges
| Type | Label | Background |
|------|-------|-----------|
| decision | Decision | `rgba(86,28,36,0.08)` |
| architecture | Architecture | `rgba(59,130,246,0.08)` |
| learning | Learning | `rgba(16,185,129,0.08)` |
| preference | Preference | `rgba(168,85,247,0.08)` |
| action_item | Action Item | `rgba(245,158,11,0.08)` |

### Grouping Logic
```typescript
const groups = $derived([
  { type: "decision", label: "Decisions", items: insights.filter(i => i.type === "decision") },
  { type: "architecture", label: "Architecture", items: insights.filter(i => i.type === "architecture") },
  { type: "learning", label: "Learnings", items: insights.filter(i => i.type === "learning") },
  { type: "preference", label: "Preferences", items: insights.filter(i => i.type === "preference") },
  { type: "action_item", label: "Action Items", items: insights.filter(i => i.type === "action_item") },
]);
```

### Data Source
Existing `GET /api/insights?project_id=<id>` endpoint. No changes.

---

## Files Changed (Summary)

| File | Change Type | Scope |
|------|------------|-------|
| `Sidebar.svelte` | Modify | Reorder nav groups and items |
| `activity/+page.svelte` | Rewrite | Rich card timeline with merged data |
| `activity/+page.server.ts` or `+page.ts` | Modify | Fetch both conversations and context list |
| `conversations/+page.svelte` | Modify | Rename, add tool filter tabs and badges |
| `insights/+page.svelte` | Modify | Group by type, add badges and source attribution |

## What Does NOT Change

- Backend API endpoints
- Database schema
- Route paths (URLs stay the same)
- Session detail page (`conversations/[id]`)
- Workspace file browser page
- Settings page
- Account page
- History page
- Any server-side data loading logic (only presentation changes)
