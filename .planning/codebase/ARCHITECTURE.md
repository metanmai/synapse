<!-- refreshed: 2026-05-15 -->
# Architecture

**Analysis Date:** 2026-05-15

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT EDGE (local)                              │
├────────────────────────────┬──────────────────────────┬──────────────────────┤
│   Claude Code hooks        │   `synapse <cmd>` CLI    │   Slash commands     │
│   `~/.claude/settings.json`│   `mcp/dist/index.js`    │   `~/.claude/        │
│   shell out to             │   (binary `synapsesync-  │    commands/synapse/`│
│   `synapse hook <kind>`    │    mcp`)                 │    *.md → `synapse`  │
└──────────────┬─────────────┴──────────────┬───────────┴──────────┬───────────┘
               │                            │                      │
               ▼                            ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        MCP WORKSPACE (`mcp/src/`)                             │
│                                                                              │
│   ┌──────────────┐    ┌─────────────────────┐    ┌────────────────────────┐ │
│   │ hooks/*.ts   │───▶│ capture/events-log  │───▶│  ~/.synapse/projects/  │ │
│   │ (6 events)   │    │  appendEvent()      │    │   <project_id>/        │ │
│   └──────────────┘    └─────────────────────┘    │   events.jsonl         │ │
│                                                   └────────┬───────────────┘ │
│   ┌─────────────────┐  ┌───────────────────┐               │                 │
│   │ cli/handlers.ts │  │ capture/daemon.ts │───────────────┘                 │
│   │  HANDLERS map   │  │ startHandoffLoop  │   reads events.jsonl            │
│   └─────────────────┘  │ flush + pull      │                                 │
│           │            │ + LLM infer       │                                 │
│           ▼            └──────────┬────────┘                                 │
│      same dir,                    │                                          │
│      same eventslog               │ HTTPS                                    │
└───────────────────────────────────┼──────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    BACKEND (`backend/src/`, Cloudflare Workers)               │
│                                                                              │
│   Hono router @ `backend/src/index.ts`                                       │
│   ┌──────────────────────┐                                                   │
│   │ POST /api/events/    │── upsert handoff_events ──▶ recompute             │
│   │      batch           │   (dedupe by event_id)      ProjectStatus         │
│   │ + cwd_<hash> auto-   │                             via reducer           │
│   │   create projects    │                             (`lib/handoff-       │
│   └──────────────────────┘                              reducer.ts`)         │
│   ┌──────────────────────┐                                                   │
│   │ GET  /api/projects/  │── select status from                              │
│   │      :id/status      │   handoff_project_status                          │
│   └──────────────────────┘                                                   │
│   ┌──────────────────────┐                                                   │
│   │ /mcp (Durable Object)│   SynapseAgent — Streamable HTTP MCP transport    │
│   └──────────────────────┘                                                   │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       SUPABASE POSTGRES (RLS-gated)                           │
│                                                                              │
│   handoff_events  →  handoff_project_status  →  handoff_sessions             │
│   handoff_issues                                                             │
│   projects · project_members · project_invites · users · api_keys            │
│   conversations · entries · insights · activity_log                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              FRONTEND (`frontend/src/`, SvelteKit, server-rendered)           │
│   `+layout.server.ts` resolves user via Supabase SSR (`lib/server/auth.ts`)  │
│   `+page.server.ts` calls backend through `lib/server/api.ts`                │
│   Routes: `(app)/dashboard/`, `(app)/projects/[name]/`, `share/[token]/`     │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| MCP CLI entry | Argv routing, MCP-server mode when stdin is not a TTY | `mcp/src/index.ts` |
| HANDLERS dispatch table | Single-source map of `synapse <cmd>` → handler | `mcp/src/cli/handlers.ts` |
| Hook dispatcher | Reads Claude Code hook JSON from stdin, fans out to handlers | `mcp/src/cli/hook-dispatch.ts` |
| Hook handlers (6) | Translate Claude Code events into handoff events | `mcp/src/hooks/*.ts` |
| Events log writer | Append-only `events.jsonl` per project with ULID `event_id` | `mcp/src/capture/events-log.ts` |
| Handoff loop | Per-project flush/pull cycle + healthcheck + LLM next-step inference | `mcp/src/capture/daemon.ts` |
| Flush/pull | `runFlushCycle`, `runPullCycle` — POST batch, GET status | `mcp/src/capture/handoff-sync.ts` |
| Brief renderer | Read cached `ProjectStatus`, format text for SessionStart injection | `mcp/src/capture/handoff-brief.ts` |
| Pure reducer | `reduce(events, project_id) → ProjectStatus` (deterministic) | `packages/shared/src/handoff/reducer.ts` |
| Event/Status types | `Event`, `ProjectStatus`, `Subtask`, `Issue`, `Actor`, `EventKind` | `packages/shared/src/handoff/types.ts`, `events.ts` |
| Backend HTTP entry | Hono app, CORS, rate-limit, mount all `/api/*` routes | `backend/src/index.ts` |
| Events batch endpoint | Idempotent upsert + auto-create projects + recompute status | `backend/src/api/events-batch.ts` |
| Project status endpoint | Read materialized `handoff_project_status.status` | `backend/src/api/project-status.ts` |
| Server-side reducer wrap | Pull all events for project, run shared reducer, upsert status | `backend/src/lib/handoff-reducer.ts` |
| Auth middleware | JWT (Supabase) or API-key bearer, sets `c.get("user")`, `c.get("tier")` | `backend/src/lib/auth.ts` |
| DB middleware | Constructs service-role Supabase client on `c.get("db")` | `backend/src/middleware/db.ts` |
| MCP Streamable HTTP | Durable Object exposing `save_insight` / `list_insights` over MCP | `backend/src/mcp/agent.ts` |
| SvelteKit shell | Server-side load → API client → render | `frontend/src/routes/(app)/+layout.server.ts` |
| Frontend API client | Token-bearing fetcher to `API_URL` | `frontend/src/lib/server/api.ts` |
| Supabase SSR auth | Session cookies via `@supabase/ssr` for browser users | `frontend/src/lib/server/auth.ts` |

## Pattern Overview

**Overall:** Event-sourced, local-first knowledge layer with deterministic state derivation.

**Key Characteristics:**
- **Pure reducer.** `reduce(events, project_id, { now? }) → ProjectStatus` in `packages/shared/src/handoff/reducer.ts` has zero side effects and is identical on client and server. Same events in → same status out.
- **Local-first event log.** Hooks/CLI append to `~/.synapse/projects/<project_id>/events.jsonl` without network I/O. The daemon flushes batches; nothing else mutates the log.
- **LWW + clock-skew guard.** `orderKey()` in `reducer.ts` sorts by `occurred_at`, but falls back to `received_at` when `occurred_at - now > 5 min`. Backend mirrors this in `events-batch.ts` (`SKEW_LIMIT_MS = 5 * 60 * 1000`).
- **Idempotency by event_id.** ULIDs (lex-monotonic, time-sortable) are the dedup key. The batch endpoint uses `upsert(..., { onConflict: "event_id", ignoreDuplicates: true })`.
- **Materialized cache on the server.** `handoff_project_status` is a single-row-per-project snapshot keyed `project_id`. Recomputed synchronously on every batch insert.
- **Pull-then-render on the client.** Daemon writes `~/.synapse/projects/<id>/cache/project_status.json` and `cache/brief.md`; the SessionStart hook reads `brief.md` and emits it to stdout in a `<synapse-brief>` block.
- **Auto-project-creation via `cwd_<hash>` placeholders.** First-run agents append events under `cwd_<sha1[0..12]>` IDs; the batch endpoint resolves them to canonical project UUIDs and returns the mapping in `canonical_project_ids`.

## Layers

**Shared types layer (`packages/shared/src/`):**
- Purpose: Common domain types across mcp, backend, frontend
- Location: `packages/shared/src/`
- Contains: `handoff/types.ts` (Event/ProjectStatus/Actor/Issue/Subtask), `handoff/events.ts` (`EventKind` enum), `handoff/reducer.ts` (the pure reducer), `types.ts` (User/Project/Entry), `insights.ts`, `conversations.ts`
- Depends on: nothing (no runtime deps in `package.json`)
- Used by: `mcp` and `backend` via `import { Event } from "@synapse/shared/handoff/types.js"`; `frontend` via `import { User } from "@synapse/shared"`

**MCP capture layer (`mcp/src/capture/`):**
- Purpose: Local event capture, daemon loop, brief rendering, OS service install
- Location: `mcp/src/capture/`
- Contains: append-only event log writer, daemon manager, flush/pull cycle, brief renderer, heuristic synth fallback, claude-haiku spawn helper, capture daemon for prior AI-session adapters
- Depends on: `@synapse/shared/handoff/*`, `node:fs`, `node:crypto`, `node:child_process`
- Used by: hook handlers, CLI handoff commands, daemon entry point

**MCP hooks layer (`mcp/src/hooks/`):**
- Purpose: Translate Claude Code hook events into handoff events
- Location: `mcp/src/hooks/`
- Contains: one file per hook kind — `session-start.ts`, `user-prompt-submit.ts`, `post-tool-use.ts`, `pre-compact.ts`, `session-end.ts`, `subagent-stop.ts`
- Depends on: `capture/events-log.ts`, `capture/actor.ts`, `capture/handoff-paths.ts`
- Used by: `cli/hook-dispatch.ts` (single switch statement)

**MCP CLI layer (`mcp/src/cli/`):**
- Purpose: User-facing `synapse <cmd>` subcommands and editor-config orchestration
- Location: `mcp/src/cli/`
- Contains: `handlers.ts` (HANDLERS map), `handoff-commands.ts` (handoff/focus/note/issue), `hook-dispatch.ts`, `init.ts`, `invite.ts`, `run-daemon.ts`, `status.ts` (doctor), `wizard.ts`, `editors/*` (claude-code/cursor/windsurf/vscode config writers)
- Depends on: `capture/*`, `hooks/*`, `@synapse/shared`
- Used by: `mcp/src/index.ts` entry point

**Backend API layer (`backend/src/api/`):**
- Purpose: HTTP endpoints, all under `/api/*` except `/auth/*` and `/mcp`
- Location: `backend/src/api/`
- Contains: one Hono sub-app per resource (`events-batch.ts`, `project-status.ts`, `project-events.ts`, `projects.ts`, `projects-resolve.ts`, `invites.ts`, `insights.ts`, `conversations.ts`, `compaction.ts`, `context.ts`, `share.ts`, `sync.ts`, `auth.ts`, `account.ts`, `admin.ts`, `billing.ts`)
- Depends on: `lib/auth.ts` (middleware), `lib/handoff-reducer.ts`, `db/queries/*`, `middleware/db.ts`
- Used by: `backend/src/index.ts` `app.route()` calls

**Backend lib layer (`backend/src/lib/`):**
- Purpose: Cross-cutting helpers
- Location: `backend/src/lib/`
- Contains: `auth.ts` (auth middleware + `hashApiKey`), `handoff-reducer.ts` (server wrapper around shared reducer), `errors.ts` (`AppError`/`NotFoundError`/`UnauthorizedError`/`ForbiddenError`/`ConflictError`), `idempotency.ts`, `rate-limit.ts`, `validate.ts`, `tier.ts`, `env.ts`, `constants.ts`, `creem.ts`, `embeddings.ts`, `export.ts`, `import.ts`, `storage.ts`, `llm/*`, `adapters/*`
- Depends on: `db/*`, `@supabase/supabase-js`
- Used by: every API route

**Backend DB layer (`backend/src/db/`):**
- Purpose: Supabase client + typed query helpers
- Location: `backend/src/db/`
- Contains: `client.ts` (`createSupabaseClient`), `queries/*` (one file per resource: `projects.ts`, `users.ts`, `api-keys.ts`, `insights.ts`, `conversations.ts`, `entries.ts`, `share-links.ts`, `subscriptions.ts`, `activity.ts`, `preferences.ts`, `deleted-accounts.ts`), `types.ts` (row shapes), `query-helpers.ts`, `search-helpers.ts`, `activity-logger.ts`
- Depends on: `@supabase/supabase-js`, `lib/env.ts`
- Used by: every API route via `c.get("db")`

**Backend MCP layer (`backend/src/mcp/`):**
- Purpose: Streamable HTTP MCP server mounted at `/mcp`
- Location: `backend/src/mcp/`
- Contains: `agent.ts` (`SynapseAgent` extends `McpAgent`), `tools/*` (one file per tool family: `context-capture.ts`, `context-retrieval.ts`, `conversations.ts`, `insights.ts`, `project-management.ts`, `google-sync.ts`), `prompts.ts`, `resources.ts`, `mcp-context.ts`
- Depends on: `@modelcontextprotocol/sdk`, `agents`, `db/*`, `lib/auth.ts`
- Used by: `backend/src/index.ts` via `app.mount("/mcp", SynapseAgent.serve("/mcp").fetch)`

**Backend infrastructure (`backend/src/durable-objects/`, `cron/`, `sync/`):**
- Purpose: Stateful or scheduled work
- Location: see directory names
- Contains: `durable-objects/compaction-scheduler.ts` (idle-delay alarm), `cron/aggregate.ts` (daily aggregation), `sync/from-google.ts`, `sync/to-google.ts`, `sync/google-auth.ts`
- Depends on: `db/*`, `lib/llm/*`
- Used by: `default.scheduled` in `backend/src/index.ts` for crons, route handlers for DO scheduling

**Frontend route layer (`frontend/src/routes/`):**
- Purpose: SvelteKit pages, server loaders, layouts
- Location: `frontend/src/routes/`
- Contains: route groups `(app)` (authenticated) and `(public)`, plus unauthenticated routes (`login/`, `signup/`, `forgot-password/`, `reset-password/`, `cli-auth/`, `share/[token]/`, `auth/callback/`, `logout/`)
- Depends on: `lib/server/api.ts`, `lib/server/auth.ts`
- Used by: SvelteKit's filesystem-based router

**Frontend lib layer (`frontend/src/lib/`):**
- Purpose: Server-only helpers + shared Svelte components
- Location: `frontend/src/lib/`
- Contains: `server/api.ts` (typed fetch wrapper), `server/auth.ts` (Supabase SSR), `components/` (Svelte 5 components organized by feature: `account/`, `activity/`, `conversations/`, `landing/`, `layout/`, `sharing/`), `types.ts` (frontend-specific types extending `@synapse/shared`)
- Depends on: `@synapse/shared`, `@supabase/ssr`
- Used by: route loaders and components

## Data Flow

### Primary Request Path — v1.1 Handoff Loop

The end-to-end handoff loop, from a user action in Claude Code to the brief that appears in the next session:

1. **Hook fires** — Claude Code triggers e.g. PostToolUse. `~/.claude/settings.json` shells out: `synapse hook post-tool-use`. (`mcp/src/cli/init.ts:18` — `HOOK_DEFS`)
2. **Hook dispatcher reads stdin** — JSON payload parsed; `cwd` hashed to `cwd_<hex12>` placeholder project_id if no project-map entry exists. (`mcp/src/cli/hook-dispatch.ts:48` — `readHookPayloadFromStdin`, `mcp/src/cli/hook-dispatch.ts:72` — `hashCwd`)
3. **Dispatch to handler** — `dispatchHook("post-tool-use", payload)` routes to `runPostToolUseHook`. (`mcp/src/cli/hook-dispatch.ts:18`)
4. **Translate to handoff events** — Handler reads `tool`, `input`, `output`, produces 1+ events with `EventKind.FileTouched`/`ToolUsed`/`CommitMade`/`BranchSwitched`/`SubtaskAdded`/`SubtaskCompleted`. (`mcp/src/hooks/post-tool-use.ts:28`)
5. **Append to events.jsonl** — `appendEvent(projectDir(project_id), partial)` writes a line containing a ULID-keyed `Event` to `~/.synapse/projects/<project_id>/events.jsonl`. (`mcp/src/capture/events-log.ts:26`)
6. **Daemon flush cycle** — `startHandoffLoop` polls every `min(pull_ms, flush_ms)` (default 10s) and on a `~/.synapse/daemon-flush-now` signal. `runFlushCycle` reads `.watermark`, slices pending events, POSTs `{ events: [...] }` to `/api/events/batch`. (`mcp/src/capture/daemon.ts:131`, `mcp/src/capture/handoff-sync.ts:29`)
7. **Backend batch handler** — `POST /api/events/batch` validates, normalises rows, clamps `occurred_at` to `now` when skew > 5 min (records `adjusted` event_ids), auto-creates projects for any `cwd_<hash>` placeholders using `git_basename` as project name, returns `canonical_project_ids` map. (`backend/src/api/events-batch.ts:37`)
8. **Upsert events** — `db.from("handoff_events").upsert(rows, { onConflict: "event_id", ignoreDuplicates: true, count: "exact" })`. (`backend/src/api/events-batch.ts:123`)
9. **Recompute ProjectStatus** — For every distinct project in the batch, `recomputeProjectStatus(db, pid)` selects all events ordered by `occurred_at`, runs the shared `reduce()`, and upserts `handoff_project_status` keyed `project_id`. (`backend/src/lib/handoff-reducer.ts:5`)
10. **Daemon rename on canonical_id remap** — If the batch response contains a `canonical_project_ids[a.project_id]` mapping, `runFlushCycle` renames `~/.synapse/projects/cwd_<hash>` → `~/.synapse/projects/<uuid>` and writes the watermark in the new dir. (`mcp/src/capture/handoff-sync.ts:48`)
11. **Daemon pull cycle** — `runPullCycle` GETs `/api/projects/<id>/status` and writes `~/.synapse/projects/<id>/cache/project_status.json`. (`mcp/src/capture/handoff-sync.ts:72`)
12. **Brief written** — `writeBrief(project_id, user_id)` calls `renderBriefFromCache`, which reads `cache/project_status.json` and produces the human-formatted brief in `cache/brief.md` (max 30 lines). (`mcp/src/capture/daemon.ts:148`, `mcp/src/capture/handoff-brief.ts:8`)
13. **Next session reads brief** — When Claude Code next starts, the SessionStart hook reads `briefCachePath(project_id)` and writes `<synapse-brief>\n{brief}\n</synapse-brief>\n` to stdout. (`mcp/src/hooks/session-start.ts:22`)
14. **UserPrompt re-injection** — If `~/.synapse/projects/<id>/last_injection.txt` is older than 1 hour and a status cache exists, `UserPromptSubmit` emits `<synapse-status-update>` to stdout. (`mcp/src/hooks/user-prompt-submit.ts:31`)

### Slash Command Flow

1. User types `/synapse-handoff Ship the migration` in Claude Code.
2. Claude Code reads `~/.claude/commands/synapse/handoff.md` (installed by `synapse init`, see `mcp/src/cli/init.ts:40` — `SLASH_COMMANDS`).
3. The markdown body says `Run \`synapse handoff "$ARGUMENTS"\``, so Claude Code shells out via the Bash tool.
4. The CLI dispatches `handoff` → `runHandoffCmd` → `appendEvent(..., kind: NextStepSet, payload: { text })`. (`mcp/src/cli/handlers.ts:169`, `mcp/src/cli/handoff-commands.ts:19`)
5. `signalFlush()` writes `~/.synapse/daemon-flush-now`, the daemon's 100ms signal-check timer picks it up and runs a cycle immediately. (`mcp/src/cli/handoff-commands.ts:8`, `mcp/src/capture/daemon.ts:155`)

### LLM Next-Step Inference

1. After idle threshold (`IDLE_THRESHOLD_MS = 30 min`, `packages/shared/src/handoff/reducer.ts:4`), `maybeFireInferNextStep` is invoked by the daemon. (`mcp/src/capture/daemon.ts:83`)
2. If the last 30 events contain no `NextStepSet`, summarise the last 30 events as `{kind}: {payload-prefix}` lines.
3. `spawnInferNextStep` invokes the local `claude` CLI in a sandboxed profile (`claude-haiku-4-5-20251001`, deny Edit/Write/Bash/Agent, `SYNAPSE_DAEMON_SESSION=1` to suppress hook re-entry). (`mcp/src/capture/daemon-cc.ts:28`)
4. On LLM failure, `synthesizeHeuristicNextStep(events)` runs — picks the latest focus/prompt/commit/branch + open subtasks. (`mcp/src/capture/heuristic-synth.ts:8`)
5. The result is appended as `EventKind.NextStepInferred` with `payload.inferred_method` ∈ `{ "llm", "heuristic" }`, actor.kind = `"synapse-daemon"`.

**State Management:**
- Truth lives in `~/.synapse/projects/<project_id>/events.jsonl` (local, append-only) and `handoff_events` table (cloud, upserted).
- `ProjectStatus` is a *derived* projection — never written by hand. Always rebuilt by `reduce()`.
- Watermark: `~/.synapse/projects/<id>/.watermark` stores the last successfully flushed `event_id` (ULID; lex-comparable to event_id strings).

## Key Abstractions

**`Event` (`packages/shared/src/handoff/types.ts:25`):**
- Purpose: The atomic unit of state change. Immutable. Idempotent by `event_id`.
- Shape: `{ event_id, project_id, session_id, actor, attached_to, kind, occurred_at, received_at, payload }`
- `actor`: `{ user_id, kind: "human"|"synapse-daemon", device_id, hostname, client }`
- `attached_to`: `Reference | null` — pointer to session/issue/file/commit
- `kind`: from `EventKind` enum — 16 named kinds (see `packages/shared/src/handoff/events.ts`)
- `payload`: open-shape JSON; each handler interprets its own keys

**`EventKind` (`packages/shared/src/handoff/events.ts:1`):**
- `SessionOpened`, `SessionClosed`, `ToolUsed`, `FileTouched`, `CommitMade`, `BranchSwitched`, `UserPrompted`, `ContextCompacted`, `SubtaskAdded`, `SubtaskCompleted`, `IssueCreated`, `IssueStateChanged`, `IssueNoted`, `FocusSet`, `NextStepSet`, `NextStepInferred`

**`ProjectStatus` (`packages/shared/src/handoff/types.ts:80`):**
- Purpose: The materialised brief view. Single row per project.
- Shape: `{ project_id, current_next_step, active_actors[], recent_activity[50], open_issues: { decisions[], questions[] }, open_subtasks[], updated_at }`
- Always derived by `reduce()`; never assembled imperatively.

**`Actor` (`packages/shared/src/handoff/types.ts:3`):**
- Resolved by `resolveActor(user_id, kind?)` in `mcp/src/capture/actor.ts:17`
- `device_id` is a random 16-hex stored once in `~/.synapse/device_id`
- `hostname` from `os.hostname()`
- `client` currently hard-coded to `"claude-code"`

**Reference (`packages/shared/src/handoff/types.ts:20`):**
- `{ type: "session"|"issue"|"file"|"commit", id }`
- Parsed by `parseRef("issue:iss_abc123")` in `mcp/src/cli/handoff-commands.ts:58`

**`HANDLERS` map (`mcp/src/cli/handlers.ts:129`):**
- Single source of truth for `synapse <cmd>` → handler. The CLI entry in `mcp/src/index.ts:159` does `HANDLERS[cmd](args.slice(1))`.
- Subcommands: `brief`, `help`, `stats`, `tree`, `status`, `doctor`, `refresh`, `upgrade`, `whoami`, `capture`, `hook`, `reset`, `uninstall`, `init`, `daemon`, `handoff`, `set-focus`, `note`, `invite`, `issue`, `wizard` (the last is registered at runtime from `index.ts`).

**`SynapseAgent` (`backend/src/mcp/agent.ts:27`):**
- Cloudflare Durable Object exposing Streamable HTTP MCP transport at `/mcp`.
- Authenticates from `Authorization: Bearer <api-key>` on init via `findUserByApiKeyHash`.
- Registers tools: project-management, context-capture, context-retrieval, insights, conversations, google-sync.

## Entry Points

**MCP CLI (`mcp/src/index.ts:224`):**
- Location: compiled to `mcp/dist/index.js`, exposed as bin `synapsesync-mcp` (see `mcp/package.json:6`).
- Triggers: user types `synapse <cmd>` (the slash commands and OS service unit alias the bin to `synapse`); editors auto-launch with no args + non-TTY stdin → MCP server mode.
- Responsibilities: argv parsing, help/version, interactive menu, MCP-stdio mode (`McpServer` + `StdioServerTransport`).

**Hook dispatcher (`mcp/src/cli/hook-dispatch.ts:18`):**
- Location: invoked via `synapse hook <kind>` from `~/.claude/settings.json` (installed by `synapse init`).
- Triggers: every Claude Code SessionStart/UserPromptSubmit/PostToolUse/PreCompact/SessionEnd/SubagentStop event.
- Responsibilities: read JSON event from stdin, derive `cwd`/`git_basename`/`project_id`, dispatch to matching hook handler in `mcp/src/hooks/`.

**OS daemon (`mcp/src/cli/run-daemon.ts:27`):**
- Location: invoked via `synapse daemon` from the launchd plist or systemd unit installed by `synapse init` (see `mcp/src/capture/os-service.ts:46`).
- Triggers: machine boot / user login (`RunAtLoad`, `KeepAlive`).
- Responsibilities: read `~/.synapse/config.json`, list tracked projects under `~/.synapse/projects/`, call `startHandoffLoop`, install SIGTERM/SIGINT handlers, block forever.

**Backend Worker (`backend/src/index.ts:96`):**
- Location: deployed to Cloudflare Workers at `api.synapsesync.app` (see `backend/wrangler.jsonc:29`).
- Triggers: HTTP requests + scheduled crons (`*/5 * * * *` Google sync, `0 3 * * *` daily aggregation).
- Responsibilities: route HTTP via Hono, run cron handlers, expose Durable Objects (`SynapseAgent`, `CompactionScheduler`).

**Frontend SvelteKit app (`frontend/src/routes/+layout.svelte`):**
- Location: deployed to Cloudflare Pages.
- Triggers: any HTTP request to the dashboard domain.
- Responsibilities: SSR shell, navigation progress, mount route groups.
- Auth gate: `frontend/src/routes/(app)/+layout.server.ts` redirects to `/login` when `locals.user` is unset.

**Capture daemon for prior AI-session adapters (`mcp/src/capture/capture-worker.ts:23`):**
- Location: spawned by `synapse capture start`.
- Triggers: explicit user action.
- Responsibilities: watch filesystem for Claude Code/Cursor/Gemini/Codex/Cline/Copilot-CLI/Roo-Code session files, parse via per-tool adapter in `mcp/src/capture/adapters/`, sync to cloud via `CloudSyncer`. This is the *prior* (pre-v1.1) capture path; the v1.1 handoff layer is independent.

## Architectural Constraints

- **Workers runtime, not Node.** Backend (`backend/src/*`) runs on Cloudflare Workers (V8 isolates). No `node:` imports allowed. Uses Web Crypto: `crypto.subtle.digest` in `backend/src/lib/auth.ts:19`, `crypto.getRandomValues` in `backend/src/api/invites.ts:8`. `nodejs_compat` flag is enabled in `backend/wrangler.jsonc:6` for select libraries (Hono + Supabase client need it) but new code should not assume Node APIs.
- **MCP runtime is Node 22+.** The CLI binary (`mcp/dist/index.js`) runs locally with full Node access — `node:fs`, `node:crypto`, `node:child_process` are fair game (see `mcp/package.json:40`).
- **No node:crypto in backend.** Random tokens use `crypto.getRandomValues(new Uint8Array(N))` then base64url-encode; SHA-256 uses `await crypto.subtle.digest("SHA-256", ...)`.
- **Reducer purity.** `packages/shared/src/handoff/reducer.ts` must remain free of I/O. `Date.now()` is allowed only when `opts.now` is unset (callers in tests pass an explicit `now` for determinism).
- **Append-only events.jsonl.** Never rewrite the file. Writers use `fs.openSync(path, "a")` (`mcp/src/capture/events-log.ts:30`).
- **ULID monotonicity.** `event_id` strings are lex-comparable; the watermark and the `since` cursor in `GET /api/projects/:id/events` both depend on this.
- **RLS-gated reads.** All `handoff_*` tables enable RLS with `project_members` mirror policies (`supabase/migrations/015_handoff_layer.sql:66-79`). Writes happen via the service role from the Worker; clients never write directly.
- **Threading.** Workers and the MCP CLI are single-threaded. The daemon uses `setInterval` timers and a 100ms signal-check loop — no worker threads.
- **Global state.** `mcp/src/capture/cli.ts` constructs module-level `DaemonManager` and `SessionStore` singletons (lines 9-10). The daemon process itself maintains in-memory `projects[]` that `startHandoffLoop` mutates in place when canonical IDs arrive.
- **No circular imports.** All `handoff/*` types are imported only from `@synapse/shared`. Backend's `lib/handoff-reducer.ts` and MCP's daemon both import the shared reducer; nothing in shared imports from mcp/backend.
- **`SYNAPSE_DAEMON_SESSION=1` reentry guard.** The daemon spawns `claude -p` with this env var; every hook handler short-circuits when it's set, preventing the inference call from generating fresh events. See `mcp/src/hooks/post-tool-use.ts:17` and siblings.

## Anti-Patterns

### Imperatively mutating `ProjectStatus`

**What happens:** Adding a field to `handoff_project_status.status` by writing JSON directly to the table.
**Why it's wrong:** `ProjectStatus` is a projection. The next batch insert will run `recomputeProjectStatus` and overwrite anything that isn't recoverable from `handoff_events`.
**Do this instead:** Add a new `EventKind` in `packages/shared/src/handoff/events.ts`, append it in the relevant handler/hook, and extend `reduce()` in `packages/shared/src/handoff/reducer.ts` to fold it into the status.

### Calling the backend from hook handlers

**What happens:** A hook handler does `await fetch("https://api.synapsesync.app/...")` to record state directly.
**Why it's wrong:** Hooks run on the foreground Claude Code process. Network I/O blocks the user, breaks offline use, and bypasses the dedupe + skew guard logic in the batch endpoint. The local-first guarantee is broken.
**Do this instead:** `appendEvent(projectDir(project_id), { ... })`. The daemon flushes asynchronously. If the hook needs an immediate flush (e.g. SessionEnd, slash commands), write `~/.synapse/daemon-flush-now`.

### Reading `events.jsonl` for status

**What happens:** A hook or component reads `events.jsonl` directly to answer "what's the next step?".
**Why it's wrong:** Re-runs the reducer in every reader; duplicates ordering logic; the per-read cost grows linearly with event count.
**Do this instead:** Read `~/.synapse/projects/<id>/cache/project_status.json` (daemon-maintained) or `cache/brief.md`. For backend-side reads, hit `GET /api/projects/:id/status`.

### Hard-coding `project_id` in CLI handlers

**What happens:** A new subcommand takes `--project <uuid>` directly from argv.
**Why it's wrong:** Users don't know their project UUIDs. Cwd resolution + `cwd_<hash>` fallback is the *contract* with the backend's auto-create flow.
**Do this instead:** Call `handlerContext()` from `mcp/src/cli/handlers.ts:105` — it resolves `project_id` from `SYNAPSE_TEST_PROJECT_ID` env override → `~/.synapse/project-map.json[cwd]` → `cwd_<sha1[0..12]>` placeholder. The placeholder is auto-resolved on first batch POST.

### Adding non-handoff queries to events-batch

**What happens:** Slipping a `db.from("projects").update(...)` into `POST /api/events/batch` because "we already have the project_id."
**Why it's wrong:** The endpoint must remain idempotent (`onConflict: "event_id", ignoreDuplicates: true`). Any non-idempotent write breaks the daemon's retry-safety guarantee.
**Do this instead:** Express the change as an event kind. The reducer applies it on recompute.

### Using Node crypto in the backend

**What happens:** `import crypto from "node:crypto"` for hashing or random bytes inside `backend/src/`.
**Why it's wrong:** Cloudflare Workers ship without Node's `crypto` module; deploys succeed (because `nodejs_compat` masks the failure) but the route 500s at runtime.
**Do this instead:** `crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))` for hashing (see `backend/src/lib/auth.ts:17`); `crypto.getRandomValues(new Uint8Array(N))` for randomness (see `backend/src/api/invites.ts:7`).

## Error Handling

**Strategy:** Typed `AppError` subclasses on the backend; CLI handlers throw and the dispatcher rethrows (process exits non-zero); hook handlers swallow on disk-write paths so Claude Code never breaks.

**Patterns:**
- Backend: `throw new NotFoundError("project missing")` → caught by `app.onError` in `backend/src/index.ts:51`, which serialises to `{ error, code }` with the `AppError.status`.
- Hooks: `mcp/src/cli/commands.ts:182` wraps every dispatch in try/catch and exits 0 even on failure — the line in the rationale: "Hooks must never break Claude Code".
- Flush cycle: `runFlushCycle` throws on non-2xx; the daemon's `cycle()` catches per-project and continues (`mcp/src/capture/daemon.ts:149`).
- LLM inference: catches any error and falls back to heuristic, logs `[handoff] LLM inference failed, falling back to heuristic` (`mcp/src/capture/daemon.ts:107`).

## Cross-Cutting Concerns

**Logging:**
- Backend: `console.error` for errors; the request error includes `c.req.method`, `c.req.path`, error message, and stack (`backend/src/index.ts:55`).
- Daemon: `console.error` + appends to `~/.synapse/capture.log` for the capture worker (`mcp/src/capture/capture-worker.ts:18`).
- CLI: `@clack/prompts` for user-facing messages, `process.stderr.write` for diagnostics.

**Validation:**
- Backend: Zod schemas centralised in `backend/src/lib/validate.ts` (`schemas.createProject`, `schemas.addMember`, `schemas.createInsight`, `schemas.resolveProject`), used via `parseBody(c, schemas.x)`.
- CLI handoff args: hand-rolled parsers in `mcp/src/cli/handoff-arg-parse.ts` that throw `Error("usage: ...")`.

**Authentication:**
- Backend: bearer token in `Authorization` header, JWT (Supabase) or API-key. `authMiddleware` (`backend/src/lib/auth.ts:31`) is applied per sub-app via `app.use("*", authMiddleware)`.
- API-key hashing: `hashApiKey(key)` returns lowercase hex SHA-256 (`backend/src/lib/auth.ts:17`).
- Frontend: Supabase SSR cookies via `@supabase/ssr`; `lib/server/auth.ts` constructs the client; `locals.user`/`locals.token` populated in hooks (the `+layout.server.ts` files redirect to `/login` when unset).
- MCP CLI: api-key in `~/.synapse/config.json` (`mcp/src/cli/invite.ts:22`).

**Idempotency:**
- HTTP: `Idempotency-Key` header allowed in CORS; `idempotency` middleware in `backend/src/lib/idempotency.ts` applied to `/api/projects/*` and `/api/insights/*` and others.
- Events: `event_id` ULIDs + `upsert(..., { onConflict: "event_id", ignoreDuplicates: true })`.

**Rate limiting:**
- `rateLimit(120, 60000)` mounted globally in `backend/src/index.ts:46` — 120 requests/minute keyed by IP or API key.

---

*Architecture analysis: 2026-05-15*
