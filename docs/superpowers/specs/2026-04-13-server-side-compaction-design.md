# Server-Side Compaction + MCP Read-Only Refactor

**Date:** 2026-04-13
**Status:** Approved

## Summary

Server-side LLM-powered compaction that automatically summarizes conversations into dense context blobs for AI agents. Plus-only feature. Includes a read-only MCP refactor that replaces write tools with a curated read interface centered on `get_context`.

The pipeline: capture daemon syncs conversation to backend → backend detects idle (5 min no new messages) → Durable Object alarm fires → Haiku compacts conversation into a summary → daily cron aggregates per-project context.

## Key Decisions

- **Trigger:** Durable Object alarm (5-min idle debounce) + manual `POST /compact` endpoint
- **LLM cost:** Synapse pays via backend Anthropic key, using Haiku for cost efficiency. Rate-limited to 50 compactions/month per user.
- **Output format:** Single dense text summary per conversation (not structured files — the existing client-side distiller handles that)
- **Project-level context:** Recency-weighted — 5 most recent conversation summaries + existing project blob re-aggregated daily via Cron Trigger + on-demand after each compaction
- **MCP refactor:** Included. Clean break — remove write tools, add read-focused tools. No backwards compatibility (no external users yet).

## Data Model

### Conversations table — new columns

```sql
ALTER TABLE conversations ADD COLUMN compacted_summary TEXT;
ALTER TABLE conversations ADD COLUMN compacted_at TIMESTAMP;
ALTER TABLE conversations ADD COLUMN compaction_model TEXT;
```

- `compacted_summary`: the LLM-generated dense context blob
- `compacted_at`: when compaction last ran (used to detect stale compactions after new messages)
- `compaction_model`: which model produced the summary (e.g., `claude-haiku-4-5-20251001`)

### New table — project_context

```sql
CREATE TABLE project_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  conversation_count INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT now()
);
```

One row per project. Stores the rolling aggregated summary of all compacted conversations. Updated by the daily cron and on-demand after each conversation compaction.

## Compaction Pipeline

### Automatic trigger (idle detection)

```
Messages appended to conversation (via cloud sync or MCP sync_conversation)
  -> conversations API handler calls CompactionScheduler DO: POST /schedule
  -> DO sets alarm: now + 5 minutes
  -> New messages arrive? Handler resets alarm to now + 5 minutes (debounce)
  -> Alarm fires (no new messages for 5 min)
    -> Load user tier from subscriptions table
    -> If not Plus: exit
    -> Check: conversation has no compacted_summary, OR updated_at > compacted_at?
    -> Load all messages for conversation
    -> Build compaction prompt
    -> Call Haiku via Anthropic API (backend's COMPACTION_LLM_KEY secret)
    -> Store compacted_summary, compacted_at, compaction_model on conversation row
    -> Re-aggregate project context:
       Load 5 most recent compacted_summary values for this project
       + existing project_context.summary (if any)
       -> Call Haiku with aggregation prompt
       -> Upsert project_context row
```

### Manual trigger

`POST /api/conversations/:id/compact`

Same compaction + aggregation logic, skips the alarm. Plus-only. Rate-limited to 10 requests/hour per user (tracked in DO state).

### Token budget

- **Conversation compaction:** max 8K input tokens to Haiku, max 1K output. For conversations exceeding 8K tokens: truncate from the middle, keeping first 10 and last 50 messages (recent context is most valuable).
- **Project aggregation:** max 4K input (5 summaries + existing context), max 1K output.

## Durable Object: CompactionScheduler

New Durable Object, separate from the existing MCP agent DO.

```
Binding: COMPACTION_SCHEDULER
Key: conversation-{conversationId}
```

### Interface

- `POST /schedule` — called by the conversations API handler after `appendMessages`. Sets/resets a 5-minute alarm.
- `alarm()` handler — fires after idle period. Loads conversation, checks tier, calls LLM, writes summary, triggers project re-aggregation.

### Why a separate DO?

The MCP DO is keyed by user session (one per active MCP connection). Compaction is keyed by conversation (one per conversation being synced). Different lifecycle, different cardinality. The MCP DO dies when the connection closes — compaction must survive that.

### Environment access

The DO receives `env` bindings (including `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `COMPACTION_LLM_KEY`) via its constructor. The `alarm()` handler creates a Supabase client from these bindings to load conversation messages and check user tier — same pattern as the existing MCP agent DO.

## Backend LLM Module

### New files

```
backend/src/lib/llm/
  types.ts        — LLMProvider interface
  anthropic.ts    — Anthropic provider (ported from mcp/src/distill/providers/)
  prompts.ts      — Compaction prompt + project aggregation prompt
  compact.ts      — Orchestrator: load messages -> prompt -> call LLM -> return summary
```

Ported from the MCP distill providers rather than shared, because the MCP package runs in Node.js (CLI) while the backend runs in Cloudflare Workers (different runtime constraints).

### Worker secrets

- `COMPACTION_LLM_KEY` — Anthropic API key for Haiku calls
- `COMPACTION_LLM_MODEL` — defaults to `claude-haiku-4-5-20251001`

### Compaction prompt (conversation-level)

> Summarize this AI coding session into a dense context document. An AI agent will read this to continue the work. Include: what was built, key decisions made, current state, and any unfinished work. Be specific — include file paths, function names, and technical details. Omit pleasantries and routine exchanges.

### Aggregation prompt (project-level)

> You are given summaries of recent AI coding sessions for a project, plus an existing project context summary. Merge them into a single updated project context. Preserve important decisions, architecture details, and current state. Remove outdated information that's been superseded by newer sessions. Keep it under 2000 words.

## API Changes

### New endpoints

| Method | Path | Purpose | Auth | Tier |
|--------|------|---------|------|------|
| `POST` | `/api/conversations/:id/compact` | Manual compaction trigger | Required | Plus |
| `GET` | `/api/projects/:id/context` | Return project-level compacted summary | Required | All (content Plus-only) |

### Modified endpoints

| Method | Path | Change |
|--------|------|--------|
| `GET` | `/api/conversations/:id` | Add `compacted_summary`, `compacted_at`, `compaction_model` to response |
| `POST` | `/api/conversations/:id/messages` | After insert, poke CompactionScheduler DO to set/reset alarm |

### Free tier behavior

- `POST /compact` -> 403: `{ error: "Compaction requires Plus", code: "TIER_LIMIT" }`
- `GET /projects/:id/context` -> `{ summary: null, upgrade_hint: "Upgrade to Plus for AI-generated project context" }`
- MCP `read_conversation` in compact mode -> first 3 messages as preview + upgrade hint

### Rate limiting

- **Burst:** 10 manual compact requests/hour per user (tracked in CompactionScheduler DO state)
- **Monthly cap:** 50 compactions/month per user (auto + manual combined). Tracked via a `compaction_count` counter on the `subscriptions` table, reset on billing cycle. When exceeded, auto-compaction skips silently and manual compact returns 429: `{ error: "Monthly compaction limit reached", code: "COMPACTION_LIMIT" }`.
- Separate from the global 120/60s rate limit

## MCP Read-Only Refactor

### Tools removed

| Tool | Reason |
|------|--------|
| `save_context` | Replaced by capture daemon |
| `save_session_summary` | Replaced by compaction |
| `delete_project` | Destructive, shouldn't be agent-initiated |

### Tools kept (unchanged)

| Tool | Reason |
|------|--------|
| `save_insight` | Users legitimately create insights via agents |
| `create_project` | Project creation is a valid agent action |

### New/modified tools

| Tool | Purpose | Tier |
|------|---------|------|
| `search` | Semantic search across conversations + insights + entries | All |
| `get_context` | Return project-level compacted summary from `project_context`. Falls back to 5 most recent conversation summaries if no aggregation exists. | All (compacted content Plus-only) |
| `list_conversations` | List conversations by project with title, tool, message count, compacted status | All |
| `read_conversation` | Load a conversation. Returns `compacted_summary` by default, full messages with `mode: "full"`. | All (compact mode Plus-only) |
| `list_insights` | List insights for a project | All |

### Key change

`get_context` becomes the primary entry point for agents. An agent starting work calls `get_context(project)` and immediately has the aggregated project knowledge — no browsing, no searching, just pre-distilled context.

## Frontend Changes

### Conversation Detail (`/projects/[name]/conversations/[id]`)

- Wire the existing compact/full toggle:
  - **Compact mode:** render `compacted_summary` as markdown. If not yet compacted: "Compaction pending..." state. If free tier: "Upgrade to Plus" placeholder.
  - **Full mode:** message thread (current behavior).
- Add "Compact now" button (Plus only). Calls `POST /api/conversations/:id/compact`. Shows spinner during LLM call, updates summary on completion.
- Show `compacted_at` timestamp and model badge below the summary.

### Project Overview (`/projects/[name]`)

- Add "Project Context" card showing truncated preview of `project_context.summary`.
- "View full context" links to the Project Context page.
- Free tier: "Upgrade to Plus for AI-generated project context" placeholder.

### Project Context (`/projects/[name]/context`)

- Replace current content with `project_context.summary` rendered as markdown.
- Show metadata: last updated, conversation count, model used.
- Add "Refresh context" button that triggers re-aggregation on demand.

### Conversations List (`/projects/[name]/conversations`)

- Add compaction status badge on each conversation card:
  - Compacted: checkmark icon
  - Pending (Plus, not yet compacted): clock icon
  - Not eligible (free tier): lock icon

### Settings

No changes. Compaction is automatic for Plus users — zero configuration.

## Cron Trigger: Project Aggregation

### Schedule

Once daily at 03:00 UTC via Cloudflare Scheduled Event.

### wrangler.toml

```toml
[triggers]
crons = ["0 3 * * *"]
```

### Logic

1. Query all projects where any conversation has `compacted_at > project_context.updated_at` (or no `project_context` row exists).
2. For each project (cap at 50 per run to stay within Workers CPU limits):
   - Load 5 most recent `compacted_summary` values
   - Load existing `project_context.summary` (if any)
   - Call Haiku with aggregation prompt
   - Upsert `project_context` row
3. If more than 50 projects need aggregation, remaining are processed in the next daily run.

### Cost estimate

50 projects x 4K input tokens x $0.80/MTok (Haiku) = ~$0.16/day. Negligible.

## Files Changed (estimated)

### New files
- `backend/src/lib/llm/types.ts`
- `backend/src/lib/llm/anthropic.ts`
- `backend/src/lib/llm/prompts.ts`
- `backend/src/lib/llm/compact.ts`
- `backend/src/durable-objects/compaction-scheduler.ts`
- `backend/src/api/compaction.ts`
- `backend/src/cron/aggregate.ts`
- `supabase/migrations/011_compaction.sql`

### Modified files
- `backend/src/index.ts` — register new routes, cron handler, DO binding
- `backend/src/api/conversations.ts` — poke CompactionScheduler after appendMessages
- `backend/src/db/queries/conversations.ts` — add compaction fields to queries
- `backend/src/db/types.ts` — add compaction types, ProjectContext type
- `backend/src/mcp/tools/context-capture.ts` — remove save_context, save_session_summary
- `backend/src/mcp/tools/context-retrieval.ts` — add get_context, read_conversation compact mode
- `backend/src/mcp/tools/conversations.ts` — add list_conversations, read_conversation
- `backend/wrangler.toml` — add DO binding, cron trigger, secrets
- `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte` — wire compact toggle, add compact button
- `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.server.ts` — load compaction data
- `frontend/src/routes/(app)/projects/[name]/+page.svelte` — add project context card
- `frontend/src/routes/(app)/projects/[name]/context/+page.svelte` — render project context summary
- `frontend/src/routes/(app)/projects/[name]/context/+page.server.ts` — load project context
- `frontend/src/routes/(app)/projects/[name]/conversations/+page.svelte` — add compaction badges
- `frontend/src/lib/server/api.ts` — add compact and project context API methods
