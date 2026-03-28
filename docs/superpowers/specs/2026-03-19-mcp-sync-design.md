# MCP-Sync: Universal AI Context Layer

## Overview

MCP-Sync is a cloud-hosted MCP server that captures, stores, and shares context across AI sessions (Claude, ChatGPT, Cursor, etc.) and team members. It acts as a universal context layer — AI tools connect via MCP or REST, humans browse and edit context via Google Docs sync.

## Goals

- Automatically capture decisions, conventions, session summaries, and architecture context during AI sessions
- Make context available across all Claude sessions without per-session setup (just connect the MCP server)
- Expose the same context via REST API for non-MCP tools (ChatGPT custom GPTs, Cursor, etc.)
- Allow humans to browse, edit, and add context via a synced Google Drive folder
- Support team sharing — invite members to a project, everyone sees the same context
- User-configurable loading strategy and capture aggressiveness

## Architecture

### Tech Stack

- **Cloudflare Workers** — MCP server + REST API + cron triggers
- **Supabase** — Postgres (data), Auth (users/API keys), Row-Level Security (team sharing)
- **Google APIs** — Drive + Docs for bidirectional sync
- **Hono** — lightweight web framework on Workers

### Why This Stack

- Cloudflare Workers: edge-deployed, fast globally, no cold starts, native cron triggers
- Supabase: managed Postgres with built-in auth, RLS, and Edge Functions if needed later. Open-source Postgres underneath — no hard vendor lock-in
- Hono: minimal, fast, designed for Workers. Handles both MCP protocol and REST routing

## Data Model

### Folder/File Structure

Context is organized into a virtual filesystem within projects:

```
Project (e.g., "mcp-sync")
├── settings/
│   └── preferences.json
├── decisions/
│   ├── 2026-03-19-use-cloudflare.md
│   └── 2026-03-15-chose-supabase.md
├── architecture/
│   └── system-overview.md
├── context/
│   ├── session-summaries/
│   │   └── 2026-03-19-brainstorm.md
│   └── team-conventions.md
└── docs/
    └── onboarding.md
```

### Database Entities

**users**
- `id` (uuid, PK)
- `email` (text, unique)
- `api_key` (text, unique, hashed)
- `google_oauth_tokens` (jsonb, encrypted)
- `created_at` (timestamptz)

**projects**
- `id` (uuid, PK)
- `name` (text)
- `owner_id` (uuid, FK → users)
- `google_drive_folder_id` (text, nullable)
- `created_at` (timestamptz)

**project_members**
- `project_id` (uuid, FK → projects)
- `user_id` (uuid, FK → users)
- `role` (text: 'owner' | 'editor' | 'viewer')
- `joined_at` (timestamptz)

**entries**
- `id` (uuid, PK)
- `project_id` (uuid, FK → projects)
- `path` (text) — virtual filesystem path, e.g., `decisions/2026-03-19-use-cloudflare.md`
- `content` (text) — markdown or JSON
- `content_type` (text: 'markdown' | 'json')
- `author_id` (uuid, FK → users, nullable — null for AI-authored)
- `source` (text: 'claude' | 'chatgpt' | 'human' | 'google_docs')
- `tags` (text[])
- `google_doc_id` (text, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

**entry_history**
- `id` (uuid, PK)
- `entry_id` (uuid, FK → entries)
- `content` (text)
- `source` (text)
- `changed_at` (timestamptz)

**user_preferences**
- `user_id` (uuid, FK → users)
- `project_id` (uuid, FK → projects)
- `auto_capture` (text: 'aggressive' | 'moderate' | 'manual_only')
- `context_loading` (text: 'full' | 'smart' | 'on_demand' | 'summary_only')

### Row-Level Security

- Users can only access entries in projects they're members of
- Role-based: viewers can read, editors can read/write, owners can manage members
- API key auth maps to user → project membership → RLS policy

## MCP Server Design

### Tools

**Context Capture:**

`save_context`
- Params: `project` (string), `path` (string), `content` (string), `tags` (string[], optional)
- Saves a context entry to the specified path within a project
- Creates parent folders implicitly
- If path exists, creates a new version (old content → entry_history)

`save_session_summary`
- Params: `project` (string), `summary` (string), `decisions` (string[], optional), `pending` (string[], optional)
- Convenience wrapper — saves to `context/session-summaries/<date>-<slug>.md`
- Extracts decisions into separate entries under `decisions/` if provided

`add_file`
- Params: `project` (string), `path` (string), `content` (string), `content_type` ('markdown' | 'json')
- Raw file add — for specs, docs, notes

**Context Retrieval:**

`get_context`
- Params: `project` (string), `path` (string)
- Returns the content of a single entry

`search_context`
- Params: `project` (string), `query` (string), `tags` (string[], optional), `folder` (string, optional)
- Keyword search across all entries in a project (Postgres full-text search)
- Filterable by tags and folder path prefix

`list_context`
- Params: `project` (string), `folder` (string, optional)
- Returns the folder tree or contents of a specific folder

`load_project_context`
- Params: `project` (string)
- Loads context based on user's `context_loading` preference:
  - `full`: returns all entries
  - `smart`: returns entries related to current working context (recent, frequently accessed)
  - `on_demand`: returns just the folder tree (user fetches individually)
  - `summary_only`: returns a generated summary of all context

**Project Management:**

`create_project`
- Params: `name` (string)
- Creates a new project, caller becomes owner

`list_projects`
- No params — returns all projects the user is a member of

`invite_member`
- Params: `project` (string), `email` (string), `role` ('editor' | 'viewer')

`remove_member`
- Params: `project` (string), `email` (string)

`set_preference`
- Params: `project` (string), `key` (string), `value` (string)
- Sets user preference for a project (auto_capture, context_loading, google_drive_folder_id)

**Google Docs Sync:**

`sync_to_google_docs`
- Params: `project` (string)
- Manually trigger a full sync from DB → Google Drive

`sync_from_google_docs`
- Params: `project` (string)
- Manually trigger a pull from Google Drive → DB

### Prompts

`session_start`
- Template that loads relevant project context based on user preferences
- Used when a Claude session begins with this MCP connected

`session_end`
- Template that prompts the AI to summarize the session and call `save_session_summary`
- Captures decisions made, conventions discovered, work completed

### Resources

- `context://{project}/tree` — the full folder tree of a project
- `context://{project}/{path}` — individual entry content

## REST API

Mirrors MCP tools for non-MCP clients. All endpoints require `Authorization: Bearer <api_key>` header.

| Method | Endpoint | Maps to MCP Tool |
|--------|----------|------------------|
| POST | `/api/context/save` | `save_context` |
| POST | `/api/context/session-summary` | `save_session_summary` |
| POST | `/api/context/file` | `add_file` |
| GET | `/api/context/:project/:path` | `get_context` |
| GET | `/api/context/:project/search?q=` | `search_context` |
| GET | `/api/context/:project/list` | `list_context` |
| GET | `/api/context/:project/load` | `load_project_context` |
| POST | `/api/projects` | `create_project` |
| GET | `/api/projects` | `list_projects` |
| POST | `/api/projects/:id/members` | `invite_member` |
| DELETE | `/api/projects/:id/members/:email` | `remove_member` |
| PUT | `/api/preferences/:project` | `set_preference` |
| POST | `/api/sync/:project/to-google` | `sync_to_google_docs` |
| POST | `/api/sync/:project/from-google` | `sync_from_google_docs` |

## Google Docs Sync

### DB → Google Docs (near-realtime)

- Triggered by a Supabase database webhook on `entries` table INSERT/UPDATE
- Webhook hits a Cloudflare Worker endpoint
- Worker converts markdown → Google Docs format, creates/updates the Doc in the linked Drive folder
- Folder structure in Drive mirrors the virtual filesystem

### Google Docs → DB (scheduled)

- Cloudflare Cron Trigger runs every 5 minutes
- Checks linked Drive folders for modified files (using Drive API `modifiedTime` filter)
- Pulls changes back into DB
- Conflict resolution: last-write-wins, both versions preserved in `entry_history`
- New files added in Drive get created as entries in the DB

### Auth

- OAuth2 flow: user connects Google account via `GET /auth/google/connect`
- Refresh tokens stored encrypted in Supabase `users.google_oauth_tokens`
- Token refresh handled automatically by the sync worker

## Auto-Capture Behavior

Since this is a remote MCP server, auto-capture is instruction-driven rather than hook-driven:

1. **Tool descriptions** include guidance: "Call `save_context` when a technical decision is made, an architecture pattern is discussed, or a team convention is established"
2. **MCP prompt `session_start`** loads context and reminds the AI of capture conventions
3. **MCP prompt `session_end`** prompts the AI to summarize and save
4. **User preference** controls aggressiveness:
   - `aggressive`: AI captures decisions, conventions, learnings, and session summaries automatically
   - `moderate`: AI captures decisions and session summaries, asks before saving other context
   - `manual_only`: AI only saves when explicitly asked

### What Gets Captured

- Technical decisions and tradeoffs evaluated
- Session summaries (what was done, what's pending)
- Conventions and preferences discovered during work
- Architecture and design context
- Meeting notes and action items (when manually added)

### What Doesn't Get Captured

- Raw code (that's in git)
- Ephemeral debugging steps (unless explicitly saved)
- Sensitive credentials or secrets

## User Onboarding

1. **Sign up:** `POST /auth/signup` with email — creates Supabase user, returns API key
2. **Connect to Claude:** `claude mcp add mcp-sync https://mcp-sync.<domain>.workers.dev --header "Authorization: Bearer <key>"`
3. **Connect to ChatGPT:** Create custom GPT with REST API as an action, configure API key
4. **Create a project:** Call `create_project` from any connected AI session
5. **Optional: Connect Google Drive:** Call `set_preference` with `google_drive_folder_id` and complete OAuth flow
6. **Invite team:** Call `invite_member` with teammate emails

## Project Structure

```
mcp-sync/
├── src/
│   ├── index.ts              # Worker entry, Hono router
│   ├── mcp/
│   │   ├── server.ts         # MCP server implementation
│   │   ├── tools.ts          # Tool definitions & handlers
│   │   └── prompts.ts        # Prompt templates (session_start, session_end)
│   ├── api/
│   │   ├── context.ts        # Context CRUD routes
│   │   ├── projects.ts       # Project management routes
│   │   └── auth.ts           # Signup, Google OAuth flow
│   ├── sync/
│   │   ├── to-google.ts      # DB → Google Docs sync
│   │   └── from-google.ts    # Google Docs → DB sync
│   ├── db/
│   │   ├── client.ts         # Supabase client init
│   │   ├── schema.ts         # Type definitions matching DB schema
│   │   └── queries.ts        # DB query functions
│   └── lib/
│       ├── auth.ts           # Auth middleware (API key validation)
│       └── types.ts          # Shared types
├── supabase/
│   └── migrations/           # DB schema migrations
├── wrangler.toml             # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

## Security

- All API keys hashed before storage (bcrypt)
- Google OAuth tokens encrypted at rest in Supabase
- Supabase Row-Level Security ensures users only access their projects
- HTTPS enforced (Cloudflare default)
- Rate limiting via Cloudflare (built-in)

## Scaling Considerations

- Cloudflare Workers scale automatically (no cold starts)
- Supabase Postgres handles the query load; connection pooling via Supabase's built-in pgbouncer
- Google Docs sync is the bottleneck — rate limited by Google API quotas (300 requests/min default). Batch operations where possible.
- For large teams/projects, consider adding a caching layer (Cloudflare KV) for frequently accessed context
