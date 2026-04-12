# Frontend Rebuild — Conversations-First Product

**Date:** 2026-04-10
**Status:** Approved

## Summary

Rebuild the Synapse frontend around conversations as the primary data model. Replace the existing filesystem-centric pages (file browser, editor, history viewer) with 6 focused pages. The AppShell and glassmorphism design system are retained; all page contents are rebuilt from scratch.

## Product Direction

Synapse is shifting from "remote filesystem for AI agents" to "your AI conversations, everywhere." The core value proposition: **you never start from scratch** — switch models like switching tabs, with full context continuity.

### Data Hierarchy

```
Workspace (personal)
  └── Projects (user-created, directory-derived, or auto-clustered)
        ├── Conversations (captured automatically via daemon/extension)
        ├── Compacted context (LLM-generated summaries, per-conversation + per-project)
        ├── Insights (auto-extracted key points, single type with auto-tags)
        └── Metadata (tool source, timestamps, tags)
```

### Tier Model

- **Free:** Everything works. 5 projects, 50 context pulls/day, personal workspace only, no compaction.
- **Plus ($9/mo):** 50 projects, unlimited pulls, shared workspaces, server-side compaction + insight extraction.

Tier enforcement is **usage limits**, not feature-blocking. No `requirePlus()` gates on endpoints — instead, quota checks on project count and pull count.

### MCP Role

MCP becomes a **read-only** interface for agents:
- `search` — semantic search across conversations and insights
- `get_context` — pull compacted project-level summary
- `list_conversations` — browse conversations by project
- `read_conversation` — load a specific conversation (compact or full)

Write operations are handled by capture (daemon + browser extension), not MCP.

## Pages

### 1. Home / Dashboard

**Route:** `/`

Project grid showing all user projects as glass cards. Each card displays:
- Project name (with AUTO badge for auto-created projects)
- Conversation count and insight count
- Tool badges (which AI tools have been used)
- Last active timestamp

**Inbox section** below the grid: unassigned conversations that haven't been matched to a project. Each shows the conversation title/first message, source tool, and timestamp. "Assign" action to manually route to a project.

**Usage footer:** Shows current usage against tier limits (projects: X/5, pulls: X/50) with upgrade link.

### 2. Project Overview

**Route:** `/projects/[name]`

Left sidebar navigation: Overview (active), Conversations, Context, Settings.

**Insights section:** List of auto-extracted insights with auto-generated tags. Each insight shows content + tags. "Show all" link.

**Recent Conversations section:** Last 3-5 conversations with title, tool badge, message count, timestamp, compacted preview, and auto-tags. Click to navigate to conversation detail. "View all conversations" link.

### 3. Conversations List

**Route:** `/projects/[name]/conversations`

Same sidebar. Content area has:
- **Search bar** — semantic search across conversation content
- **Tool filter tabs** — All, Claude Code, Cursor, claude.ai, ChatGPT, Gemini (dynamic based on what tools have conversations in this project)
- **Conversation cards** — title, tool badge, message count, timestamp, compacted preview, auto-tags. Click to open detail.

### 4. Conversation Detail

**Route:** `/projects/[name]/conversations/[id]`

Same sidebar. Content area has:
- **Header:** conversation title, source tool, message count, token count, date
- **View toggle:** Compact / Full transcript (two buttons, toggle between views)
- **"Continue in..." dropdown:** Claude.ai, ChatGPT, Gemini, Copy context

**Compact view** (default):
- Structured summary of the conversation
- Key decisions, architecture changes, outcomes as bullet lists
- "Insights extracted" section showing which insights came from this conversation

**Full transcript view:**
- Chat-style message thread with user/assistant avatars
- Role labels (You, Claude Code, etc.)
- Message content with formatting preserved
- Collapsible "N more messages" divider for long conversations

**Footer:** Source tool, message count, token estimate.

### 5. Project Context

**Route:** `/projects/[name]/context`

Same sidebar. Shows the **aggregated project-level summary** — the rolling context generated from all compacted conversations + insights.

- Structured markdown: project description, architecture, current direction, key decisions
- Provenance note: "Auto-generated from N conversations, last updated X ago"
- "This is what agents receive when they call get_context('project-name')"
- **Regenerate** and **Edit** buttons

Free tier: this page exists but shows a prompt to upgrade (compaction is Plus-only). The raw conversations and insights are still browsable.

### 6. Settings

**Route:** `/settings`

No sidebar. Full-width sections:

**Plan section:** Current tier, project usage (X/5 with progress bar), pull usage (X/50 with progress bar), upgrade CTA button.

**Capture Status:** Daemon status (running/stopped with PID), browser extension status (connected/disconnected), sessions captured today.

**API Keys:** List of active keys with labels, status, and revoke buttons. "New API Key" button.

## Pages Being Removed

| Current Page | Disposition |
|---|---|
| File browser (`/projects/[name]`) | Replaced by Project Overview |
| File editor/viewer | Removed — no more file CRUD |
| History viewer | Removed — no entry versioning in new model |
| Insights page (manual CRUD) | Replaced by auto-insights on Project Overview |
| Conversations list (Plus-gated) | Replaced by ungated Conversations List |
| Conversation viewer | Replaced by Conversation Detail (compact + full) |
| Import page | Removed for now — capture replaces manual import |

## Components to Build

### New Components
- `ProjectCard` — glass card for home grid (name, stats, tool badges, timestamp)
- `InboxItem` — unassigned conversation row with assign action
- `UsageBar` — tier usage display with limits and upgrade link
- `InsightItem` — insight with content + auto-tags
- `ConversationCard` — conversation list item with preview, tool badge, tags
- `ChatMessage` — user/assistant message bubble for transcript view
- `CompactView` — structured summary display
- `ViewToggle` — compact/full toggle buttons
- `ContinueIn` — dropdown for cross-model continuation
- `ContextSummary` — project-level aggregated context display
- `ToolFilterTabs` — filter pills for conversation list
- `ProjectSidebar` — sidebar nav within project pages

### Retained Components
- `AppShell` — header, layout, background orbs
- `NavigationProgress` — route transition loading bar
- All glassmorphism CSS utilities and design tokens

## Design System

Retained as-is from current frontend:

- **Colors:** Cream bg (#e8d8c4), burgundy text (#561c24), muted brown (#8a7565)
- **Glass:** `rgba(255, 253, 248, 0.7)` + `backdrop-filter: blur(20px)` + warm shadows
- **Typography:** Lato, 15px base, -0.02em letter-spacing on headings
- **Buttons:** Pill-shaped (9999px radius), burgundy gradient primary
- **Radius:** 12px (sm), 16px (md), 9999px (pill)
- **Shadows:** Warm-toned using `rgba(86, 28, 36, X%)`
- **Animations:** Float orbs, grain texture overlay

## Tool Badges

Each AI tool gets a distinct color badge:
- Claude Code: burgundy bg, burgundy text
- Cursor: blue bg, blue text
- Gemini: green bg, green text
- ChatGPT: teal bg, teal text
- claude.ai: light burgundy bg, muted burgundy text
- Copilot: (to be defined)
- Cline/Roo Code: (to be defined)

## Data Flow

```
Capture (daemon/extension)
  → POST /api/conversations (with messages)
  → Auto-assign to project (directory path or content matching)
  → Server-side compaction (Plus tier, async)
  → Insight extraction (Plus tier, async)
  → Project context regeneration (on new compaction)
```

Frontend reads:
- `GET /api/projects` — project list for home
- `GET /api/conversations?project_id=X` — conversation list
- `GET /api/conversations/:id` — full conversation with messages
- `GET /api/insights?project_id=X` — insights for project
- Project context: new endpoint or derived from compacted data

## Backend Changes Required

Minimal — most infrastructure exists:

1. **Lift conversations to free tier** — remove `requireConversationSync()` gate
2. **Add quota middleware** — `checkQuota(userId, "projects")` and `checkQuota(userId, "context_pulls")` returning 429 when exceeded
3. **Simplify insights** — single `insight` type instead of 5 categories, add auto-tags
4. **Project context endpoint** — `GET /api/projects/:id/context` returning aggregated summary
5. **Conversation compaction** — new field on conversations table for compacted summary (Plus tier, async worker)
6. **Auto-project assignment** — logic to match incoming conversations to projects by directory path

## "Continue in..." Flow

1. User clicks "Continue in Claude.ai" on conversation detail page
2. Frontend calls API to generate a continuation prompt (compacted context + handoff message)
3. Opens claude.ai in new tab with the prompt copied to clipboard (MVP)
4. Future: browser extension intercepts and auto-fills the prompt

## Page Wireframes

### 1. Home / Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse                          tanmai@synapse.dev │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Your Projects                            [+ New Project]   │
│                                                             │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  │ synapse            │ │ octopay            │ │ meal-prep    AUTO │
│  │ 34 convos · 8 ins  │ │ 12 convos · 3 ins  │ │ 5 convos · 1 ins  │
│  │ 2h ago             │ │ 3d ago             │ │ 1w ago             │
│  │ [claude] [cursor]  │ │ [gemini] [chatgpt] │ │ [claude.ai]        │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘
│                                                             │
│  ─── Inbox (3 unassigned) ─────────────────────────────     │
│  "Help me write a cover letter"   claude.ai · 2h   Assign  │
│  "Debug nginx config"             chatgpt · 5h     Assign  │
│  "Recipe for dal makhani"         gemini · 1d      Assign  │
│                                                             │
│  Projects: 3/5 · Pulls today: 12/50        Upgrade to Plus │
└─────────────────────────────────────────────────────────────┘
```

### 2. Project Overview

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse  ›  synapse                                 │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Overview │  Insights (8)                                    │
│ ──────── │                                                  │
│ Convos   │  ● Auth uses Supabase with PKCE for CLI          │
│ Context  │    #auth #supabase #cli                          │
│ Settings │                                                  │
│          │  ● Chose Hono over Express for CF Workers        │
│          │    #backend #framework                           │
│          │                                                  │
│          │  ● Tier gating: usage limits, not features       │
│          │    #billing #product                             │
│          │                                                  │
│          │  Show all 8 →                                    │
│          │                                                  │
│          │  ──────────────────────────────────────────      │
│          │                                                  │
│          │  Recent Conversations                            │
│          │                                                  │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Backend restructuring           2h ago │      │
│          │  │ [claude-code] · 45 messages             │      │
│          │  │ Discussed new tier model, MCP...        │      │
│          │  │ #backend #tiers #architecture           │      │
│          │  └────────────────────────────────────────┘      │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Capture adapter expansion       5d ago │      │
│          │  │ [claude-code] · 120 messages            │      │
│          │  │ Added Cline, Roo Code, Copilot CLI...   │      │
│          │  │ #capture #adapters #testing             │      │
│          │  └────────────────────────────────────────┘      │
│          │                                                  │
│          │  View all conversations →                        │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 3. Conversations List

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse  ›  synapse  ›  Conversations               │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Overview │  [Search conversations...                    ]   │
│ Convos   │                                                  │
│ ──────── │  (All) (Claude Code) (Cursor) (claude.ai)        │
│ Context  │  (ChatGPT) (Gemini)                              │
│ Settings │                                                  │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Backend restructuring           2h ago │      │
│          │  │ [claude-code] · 45 messages             │      │
│          │  │ Discussed new tier model, MCP...        │      │
│          │  │ #backend #tiers #architecture           │      │
│          │  └────────────────────────────────────────┘      │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Capture adapter expansion       5d ago │      │
│          │  │ [claude-code] · 120 messages            │      │
│          │  │ Added Cline, Roo Code, Copilot CLI...   │      │
│          │  │ #capture #adapters #testing             │      │
│          │  └────────────────────────────────────────┘      │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Auth middleware debugging        2w ago │      │
│          │  │ [claude.ai] · 22 messages               │      │
│          │  │ Fixed JWT validation for expired...     │      │
│          │  │ #auth #debugging                       │      │
│          │  └────────────────────────────────────────┘      │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Glassmorphism restyle            2w ago │      │
│          │  │ [claude-code] · 85 messages             │      │
│          │  │ Restyled the app UI to match...         │      │
│          │  │ #frontend #styling                     │      │
│          │  └────────────────────────────────────────┘      │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 4. Conversation Detail — Compact View

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse  ›  synapse  ›  Convos  ›  Backend restr... │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Overview │  Backend restructuring                           │
│ Convos   │  claude-code · 45 msgs · ~32k tokens · Apr 10   │
│ Context  │                                                  │
│ Settings │  [Compact] [Full transcript]   [Continue in.. ▾] │
│          │                                                  │
│          │  ┌────────────────────────────────────────┐      │
│          │  │ Discussed restructuring the backend    │      │
│          │  │ to match new product direction.        │      │
│          │  │ Conversations become the primary data  │      │
│          │  │ model, replacing entries/files.         │      │
│          │  │                                        │      │
│          │  │ Key Decisions                          │      │
│          │  │ • Entries table deprecated              │      │
│          │  │ • Usage limits, not feature gates       │      │
│          │  │ • Free: 5 projects, 50 pulls/day       │      │
│          │  │ • MCP becomes read-only                │      │
│          │  │                                        │      │
│          │  │ Architecture Changes                   │      │
│          │  │ • Conversations are the core model      │      │
│          │  │ • Insights auto-extracted w/ auto-tags  │      │
│          │  │ • Compaction replaces distill           │      │
│          │  │                                        │      │
│          │  │ ── Insights extracted (3) ───────────  │      │
│          │  │ ● Entries deprecated → projects         │      │
│          │  │   #architecture #migration             │      │
│          │  │ ● Projects: user/dir/auto-clustered    │      │
│          │  │   #product #projects                   │      │
│          │  │ ● Compaction replaces distill           │      │
│          │  │   #architecture #compaction            │      │
│          │  ├────────────────────────────────────────┤      │
│          │  │ Source: claude-code · 45 msgs · ~32k   │      │
│          │  └────────────────────────────────────────┘      │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 4b. Conversation Detail — Full Transcript View

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse  ›  synapse  ›  Convos  ›  Backend restr... │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Overview │  Backend restructuring                           │
│ Convos   │  claude-code · 45 msgs · ~32k tokens · Apr 10   │
│ Context  │                                                  │
│ Settings │  [Compact] [Full transcript]   [Continue in.. ▾] │
│          │                                                  │
│          │  ┌────────────────────────────────────────┐      │
│          │  │                                        │      │
│          │  │  (T) YOU                               │      │
│          │  │  Where are we in terms of              │      │
│          │  │  implementation?                       │      │
│          │  │                                        │      │
│          │  │  (S) CLAUDE CODE                       │      │
│          │  │  Here's where Synapse stands:          │      │
│          │  │  • Core Platform — Backend API, ...     │      │
│          │  │  • Capture Phase 1 — 7 adapters...     │      │
│          │  │  • Distill Phase 2 — LLM-powered...    │      │
│          │  │                                        │      │
│          │  │  (T) YOU                               │      │
│          │  │  I feel like the MCP idea and the      │      │
│          │  │  daemon idea are sort of conflicting?  │      │
│          │  │                                        │      │
│          │  │  (S) CLAUDE CODE                       │      │
│          │  │  That's a sharp observation — yes,     │      │
│          │  │  there's tension there...              │      │
│          │  │                                        │      │
│          │  │        ··· 38 more messages ···        │      │
│          │  │                                        │      │
│          │  │  (T) YOU                               │      │
│          │  │  We need to start re-structuring       │      │
│          │  │  the backend                           │      │
│          │  │                                        │      │
│          │  │  (S) CLAUDE CODE                       │      │
│          │  │  I recommend Approach B: Evolve in     │      │
│          │  │  Place — restructure in phases...      │      │
│          │  │                                        │      │
│          │  ├────────────────────────────────────────┤      │
│          │  │ Source: claude-code · 45 msgs · ~32k   │      │
│          │  └────────────────────────────────────────┘      │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 5. Project Context

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse  ›  synapse  ›  Context                     │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ Overview │  Project Context                                 │
│ Convos   │  Auto-generated from 34 conversations · 2h ago   │
│ Context  │                                                  │
│ ──────── │  ┌────────────────────────────────────────┐      │
│ Settings │  │ Synapse is a context management tool   │      │
│          │  │ with a SvelteKit frontend, Cloudflare  │      │
│          │  │ Workers backend, and an MCP server.    │      │
│          │  │                                        │      │
│          │  │ Architecture                           │      │
│          │  │ • Backend: Hono on CF Workers           │      │
│          │  │ • DB: Supabase (Postgres + Auth)        │      │
│          │  │ • Frontend: SvelteKit on CF Pages       │      │
│          │  │ • Billing: Creem                        │      │
│          │  │                                        │      │
│          │  │ Current Direction                      │      │
│          │  │ • Conversations as primary data model  │      │
│          │  │ • Auto-capture from 7 AI tools          │      │
│          │  │ • Browser extension for web UIs         │      │
│          │  │ • Usage-based tiers, not features       │      │
│          │  │                                        │      │
│          │  │ Key Decisions                          │      │
│          │  │ • Entries/files deprecated              │      │
│          │  │ • Insights = single type + auto-tags   │      │
│          │  │ • MCP = read-only interface             │      │
│          │  │ • Compaction replaces distill           │      │
│          │  │                                        │      │
│          │  │ This is what agents receive when they  │      │
│          │  │ call get_context("synapse")            │      │
│          │  │                                        │      │
│          │  │ [Regenerate]  [Edit]                   │      │
│          │  └────────────────────────────────────────┘      │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 6. Settings

```
┌─────────────────────────────────────────────────────────────┐
│  [logo] Synapse                          tanmai@synapse.dev │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Settings                                                   │
│                                                             │
│  ┌─ Plan ─────────────────────────────────────────────┐     │
│  │ Current plan          Free                         │     │
│  │ Projects              3 / 5      [████████░░░░] 60%│     │
│  │ Context pulls today   12 / 50    [████░░░░░░░░] 24%│     │
│  │                                                    │     │
│  │ [Upgrade to Plus — $9/mo]                          │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ Capture Status ───────────────────────────────────┐     │
│  │ Daemon              ● Running (PID 4821)           │     │
│  │ Browser Extension   ● Connected                    │     │
│  │ Sessions today      3                              │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ API Keys ─────────────────────────────────────────┐     │
│  │ cli-default         ● Active            [Revoke]   │     │
│  │ cursor-plugin       ● Active            [Revoke]   │     │
│  │                                                    │     │
│  │ [+ New API Key]                                    │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Interactive Mockup

Full clickable prototype with Synapse's glassmorphism styling available at:
`.superpowers/brainstorm/91265-1775820605/content/full-app-flow.html`

Open in a browser to navigate between all 6 pages.
