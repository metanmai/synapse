# Codebase Structure

**Analysis Date:** 2026-05-15

## Directory Layout

```
synapse/
├── mcp/                        # MCP server + CLI (`synapsesync-mcp` bin)
│   ├── src/
│   │   ├── index.ts            # CLI entry point + MCP stdio server
│   │   ├── capture/            # Event log, daemon, flush/pull, brief
│   │   │   └── adapters/       # Pre-v1.1 session adapters (claude-code, cursor, ...)
│   │   ├── cli/                # Subcommand handlers
│   │   │   └── editors/        # Editor config writers
│   │   └── hooks/              # Claude Code hook handlers (6 kinds)
│   ├── scripts/                # Build helpers (add-shebang.mjs)
│   ├── test/                   # vitest suites
│   │   ├── capture/            # Daemon, flush, log, brief tests
│   │   ├── cli/                # Handler dispatch + per-command tests
│   │   ├── e2e/                # Full local→backend roundtrip
│   │   ├── fixtures/           # Captured-session JSON fixtures per tool
│   │   ├── hooks/              # Hook-handler unit tests
│   │   ├── integration/        # Cross-module integration
│   │   ├── perf/               # Performance assertions
│   │   └── unit/               # Pure-function unit tests
│   ├── package.json            # bin "synapsesync-mcp" → dist/index.js
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── manifest.json
│
├── backend/                    # Cloudflare Workers HTTP API
│   ├── src/
│   │   ├── index.ts            # Hono app, route mounting, scheduled handlers
│   │   ├── api/                # One Hono sub-app per resource
│   │   ├── db/                 # Supabase client + typed query helpers
│   │   │   └── queries/        # One file per resource
│   │   ├── lib/                # Cross-cutting (auth, errors, env, reducer wrap, ...)
│   │   │   ├── llm/            # Compaction prompts + Anthropic adapter
│   │   │   └── adapters/       # Message-format adapters (anthropic, openai, raw)
│   │   ├── mcp/                # Streamable HTTP MCP server (Durable Object)
│   │   │   └── tools/          # MCP tool registrations
│   │   ├── middleware/         # Hono middleware (db, project-auth)
│   │   ├── durable-objects/    # CompactionScheduler
│   │   ├── cron/               # Scheduled handlers (daily aggregation)
│   │   └── sync/               # Google Drive bidirectional sync
│   ├── test/                   # vitest with @cloudflare/vitest-pool-workers
│   │   ├── api/                # One test file per endpoint
│   │   ├── db/                 # Query helper tests
│   │   ├── lib/                # Library unit tests
│   │   └── setup.ts            # Test environment
│   ├── package.json            # @synapse/backend
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── wrangler.jsonc          # Workers config, DO bindings, cron triggers
│
├── frontend/                   # SvelteKit dashboard
│   ├── src/
│   │   ├── routes/             # Filesystem-based router (Svelte 5)
│   │   │   ├── (app)/          # Authenticated route group
│   │   │   │   ├── account/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── home/
│   │   │   │   ├── projects/[name]/{activity,context,conversations/[id],settings}/
│   │   │   │   └── settings/
│   │   │   ├── (public)/{privacy,terms}/
│   │   │   ├── auth/callback/
│   │   │   ├── cli-auth/
│   │   │   ├── forgot-password/
│   │   │   ├── login/
│   │   │   ├── logout/
│   │   │   ├── reset-password/
│   │   │   ├── share/[token]/
│   │   │   └── signup/
│   │   ├── lib/
│   │   │   ├── server/         # SSR-only helpers (api.ts, auth.ts)
│   │   │   ├── components/     # Svelte 5 components by feature
│   │   │   │   ├── account/
│   │   │   │   ├── activity/
│   │   │   │   ├── conversations/
│   │   │   │   ├── landing/
│   │   │   │   ├── layout/
│   │   │   │   └── sharing/
│   │   │   └── types.ts        # Frontend-specific types
│   │   └── test-mocks/
│   ├── static/                 # Public assets
│   ├── package.json
│   ├── svelte.config.js
│   ├── vite.config.ts
│   └── vitest.config.ts
│
├── packages/
│   └── shared/                 # @synapse/shared — cross-workspace types
│       ├── src/
│       │   ├── handoff/        # v1.1 handoff layer types + reducer
│       │   │   ├── events.ts   # EventKind enum
│       │   │   ├── reducer.ts  # Pure reduce(events) → ProjectStatus
│       │   │   └── types.ts    # Event, Actor, ProjectStatus, Issue, Subtask
│       │   ├── conversations.ts
│       │   ├── insights.ts
│       │   └── types.ts        # User, Project, Entry, ActivityLogEntry, ...
│       ├── test/handoff/       # Reducer + types tests
│       └── package.json        # main "./src/types.ts", subpath exports
│
├── supabase/
│   ├── migrations/             # Numbered SQL migrations 000..017
│   └── templates/              # Auth email templates
│
├── embedding-service/          # FastAPI service for semantic search vectors
│   ├── app.py
│   ├── backfill.py
│   ├── Dockerfile
│   └── requirements*.txt
│
├── docs/                       # Long-form design docs + retrospectives
│   ├── drafts/
│   ├── retrospectives/
│   └── superpowers/{plans,specs}/
│
├── .planning/                  # GSD planning artefacts (this directory)
│   └── codebase/
│
├── .claude/                    # Claude Code workspace + slash commands
├── .superpowers/               # Brainstorm session artefacts
├── biome.json                  # Linter + formatter config
├── package.json                # npm workspaces — packages/*, backend, frontend, mcp
├── CLAUDE.md                   # Project-level Claude instructions
├── README.md
└── CHANGELOG.md
```

## Directory Purposes

**`mcp/src/`:**
- Purpose: Local-side CLI + MCP stdio server. Compiles to `mcp/dist/`. Distributed on npm as `synapsesync-mcp` (binary name; aliased to `synapse` by `synapse init`).
- Contains: argv router (`index.ts`), capture/daemon code, hook handlers, CLI handlers, editor config writers
- Key files: `index.ts` (entry), `cli/handlers.ts` (HANDLERS dispatch map), `capture/daemon.ts` (handoff loop), `capture/events-log.ts` (append-only writer)

**`mcp/src/capture/`:**
- Purpose: Local persistence + the v1.1 handoff loop + the pre-v1.1 session capture daemon
- Contains: `events-log.ts` (ULID + jsonl writer), `handoff-paths.ts` (`~/.synapse/...` path resolvers), `handoff-sync.ts` (flush/pull cycles), `handoff-brief.ts` (renderer), `daemon.ts` (handoff loop manager), `daemon-cc.ts` (claude-haiku spawn), `heuristic-synth.ts` (fallback inference), `actor.ts` (device_id + hostname resolver), `os-service.ts` (launchd/systemd unit writer), `store.ts` + `watcher.ts` + `capture-worker.ts` + `cli.ts` (legacy capture daemon), `adapters/` (legacy per-tool session parsers)
- Key files: `events-log.ts`, `handoff-paths.ts`, `daemon.ts`, `handoff-sync.ts`, `handoff-brief.ts`

**`mcp/src/cli/`:**
- Purpose: Everything reachable through `synapse <subcommand>`
- Contains: `handlers.ts` (HANDLERS map), `commands.ts` (legacy status/refresh/tree/upgrade/reset/uninstall), `hook-dispatch.ts` (stdin→handler), `handoff-commands.ts` (handoff/focus/note/issue events), `handoff-arg-parse.ts` (argv parsers), `init.ts` (hook install + slash commands install + service-file install), `invite.ts`, `run-daemon.ts`, `status.ts` (handoff doctor), `wizard.ts`, `welcome.ts`, `stats.ts`, `project-map.ts`, `resolve-project.ts`, `theme.ts`, `glyph.ts`, `spinner.ts`, `config.ts`, `api.ts`, `browser-auth.ts`, `editors/` (per-editor config writers)
- Key files: `handlers.ts`, `hook-dispatch.ts`, `handoff-commands.ts`, `init.ts`

**`mcp/src/cli/editors/`:**
- Purpose: Write/remove MCP config blocks for each supported editor
- Contains: `claude-code.ts`, `cursor.ts`, `vscode.ts`, `windsurf.ts`, `detect.ts`, `orchestrate.ts`, `io.ts`, `index.ts` (barrel)

**`mcp/src/hooks/`:**
- Purpose: One file per Claude Code hook event kind. Each translates the event into 0+ handoff events appended to `events.jsonl`.
- Contains: `session-start.ts` (emits brief + `SessionOpened`), `user-prompt-submit.ts` (`UserPrompted` + status re-injection ≥1h), `post-tool-use.ts` (`FileTouched`/`ToolUsed`/`CommitMade`/`BranchSwitched`/`SubtaskAdded`/`SubtaskCompleted`), `pre-compact.ts` (`ContextCompacted`), `session-end.ts` (`SessionClosed` + flush signal), `subagent-stop.ts` (`ToolUsed` with tool=`Agent`)

**`backend/src/`:**
- Purpose: HTTP API on Cloudflare Workers. Deployed to `api.synapsesync.app`.
- Contains: `index.ts` (Hono app), `api/` (one sub-app per resource), `db/` (Supabase client + queries), `lib/` (cross-cutting), `mcp/` (Streamable HTTP MCP server), `middleware/`, `durable-objects/`, `cron/`, `sync/`
- Key files: `index.ts`, `api/events-batch.ts`, `api/project-status.ts`, `lib/handoff-reducer.ts`, `lib/auth.ts`, `mcp/agent.ts`

**`backend/src/api/`:**
- Purpose: HTTP route handlers
- Contains: `events-batch.ts` (POST /api/events/batch — handoff event ingest), `project-status.ts` (GET /api/projects/:id/status), `project-events.ts` (GET /api/projects/:id/events), `projects.ts` (CRUD), `projects-resolve.ts` (cwd/origin/name fuzzy resolve), `invites.ts` (mint/accept), `insights.ts`, `conversations.ts`, `compaction.ts`, `context.ts`, `share.ts`, `sync.ts`, `auth.ts` (login/signup/google-oauth), `account.ts`, `admin.ts`, `billing.ts` (creem)
- All mounted under `/api/*` (or `/auth/*` for the auth sub-app) in `backend/src/index.ts:70-87`

**`backend/src/db/`:**
- Purpose: Service-role Supabase client + typed query layer
- Contains: `client.ts` (`createSupabaseClient(env)`), `queries/index.ts` (barrel) + one file per resource (`projects.ts`, `users.ts`, `api-keys.ts`, `insights.ts`, `conversations.ts`, `entries.ts`, `share-links.ts`, `subscriptions.ts`, `activity.ts`, `preferences.ts`, `deleted-accounts.ts`), `types.ts` (row shapes), `activity-logger.ts`, `query-helpers.ts`, `search-helpers.ts`

**`backend/src/lib/`:**
- Purpose: Workers-runtime cross-cutting helpers
- Contains: `auth.ts` (Hono middleware + `hashApiKey`), `handoff-reducer.ts` (server wrap around `@synapse/shared/handoff/reducer.js`), `env.ts` (`Env` type + `envList`/`envOr`), `errors.ts` (`AppError` subclasses), `idempotency.ts`, `rate-limit.ts`, `validate.ts` (zod schemas), `tier.ts` (quota enforcement), `constants.ts`, `creem.ts` (billing API), `embeddings.ts` (semantic search), `export.ts`/`import.ts` (zip), `storage.ts`, `llm/*`, `adapters/*`

**`backend/src/mcp/`:**
- Purpose: Streamable HTTP MCP server mounted at `/mcp`
- Contains: `agent.ts` (`SynapseAgent` Durable Object), `tools/` (one file per tool family: `context-capture.ts`, `context-retrieval.ts`, `conversations.ts`, `google-sync.ts`, `insights.ts`, `project-management.ts`), `prompts.ts`, `resources.ts`, `mcp-context.ts`

**`backend/src/durable-objects/`, `cron/`, `sync/`:**
- `durable-objects/compaction-scheduler.ts` — DO with idle-delay alarm for server-side conversation summarisation
- `cron/aggregate.ts` — daily 03:00 UTC handler
- `sync/from-google.ts`, `to-google.ts`, `google-auth.ts` — Google Drive bidirectional sync

**`frontend/src/routes/`:**
- Purpose: SvelteKit filesystem router. Each route is a folder with `+page.svelte` (UI), `+page.server.ts` (loader), and optionally `+layout.*`.
- Route groups: `(app)` requires auth, `(public)` doesn't (parens are SvelteKit grouping — they do not appear in the URL).

**`frontend/src/lib/`:**
- Purpose: SvelteKit `$lib` alias root
- Contains: `server/` (SSR-only — `api.ts` exports `createApi(token)`, `auth.ts` exports `getSupabase(cookies)`), `components/` (Svelte 5 components organized by feature folder), `types.ts` (frontend-specific types extending `@synapse/shared`)

**`packages/shared/src/`:**
- Purpose: Cross-workspace TypeScript types and the pure handoff reducer
- Contains: `types.ts` (User/Project/Entry/ActivityLogEntry/...), `insights.ts` (`Insight`, `InsightType`), `conversations.ts` (`CanonicalMessage`, `Conversation`, ...), `handoff/types.ts` (Event, ProjectStatus, Actor, Issue, Subtask), `handoff/events.ts` (`EventKind` enum), `handoff/reducer.ts` (the pure `reduce()` function)
- Imports nothing at runtime (no `dependencies` in package.json)
- Exposed via `exports` map in `packages/shared/package.json`:
  - `"@synapse/shared"` → `./src/types.ts`
  - `"@synapse/shared/handoff/types.js"` → `./src/handoff/types.ts`
  - `"@synapse/shared/handoff/events.js"` → `./src/handoff/events.ts`
  - `"@synapse/shared/handoff/reducer.js"` → `./src/handoff/reducer.ts`

**`supabase/migrations/`:**
- Purpose: Numbered, sequential SQL migrations executed in order by `supabase db push`
- Contains: 000-017 (000 is delete_user + rollback, 001 is initial schema, 015 introduced the handoff layer, 017 added project_invites)
- Naming: `NNN_short_description.sql` — numbers monotonic, never gaps

**`embedding-service/`:**
- Purpose: Standalone FastAPI service exposing embedding endpoint for semantic search backfill
- Contains: `app.py` (FastAPI server), `backfill.py` (one-shot backfill), `Dockerfile`, `requirements.txt`/`requirements-backfill.txt`, `test_embed.py`
- Not a workspace member; deployed separately (referenced via `EMBEDDING_SERVICE_URL` env var)

**`docs/`:**
- Purpose: Hand-curated design docs not generated by GSD
- Contains: `drafts/` (in-progress design), `retrospectives/` (post-mortems), `superpowers/{plans,specs}/`

**`.planning/`:**
- Purpose: GSD command output (codebase maps, plans, phase artefacts)
- Generated: Yes — by `/gsd-map-codebase`, `/gsd-plan-phase`
- Committed: Yes

**`.superpowers/`:**
- Purpose: Brainstorm session artefacts
- Generated: Yes
- Committed: Yes (small, per-session dirs)

**`.worktrees/`, `.claire/`:**
- Purpose: Local-only checkout layers; mostly empty in main

## Key File Locations

**Entry Points:**
- `mcp/src/index.ts` — MCP CLI / stdio server entry; line 224 (`const args = process.argv.slice(2);`) is where execution begins
- `backend/src/index.ts` — Hono app + scheduled handlers; the `export default` block at line 96 is the Workers entry
- `frontend/src/routes/+layout.svelte` — top-level SvelteKit shell (wraps `(app)` and `(public)` groups)
- `mcp/src/cli/run-daemon.ts` — OS-service entry (`synapse daemon` subcommand)

**Configuration:**
- `backend/wrangler.jsonc` — Cloudflare Workers config, DO bindings, cron triggers, custom domain
- `frontend/svelte.config.js`, `frontend/vite.config.ts` — SvelteKit config + Vite plugins
- `biome.json` — top-level lint/format (Biome replaces ESLint + Prettier)
- `package.json` (root) — workspaces declaration: `packages/*`, `backend`, `frontend`, `mcp`
- `mcp/manifest.json` — npm `bin` declaration plus metadata
- `.env.example`, `.dev.vars.example` — env var templates

**Core Logic:**
- `packages/shared/src/handoff/reducer.ts` — the pure reducer; canonical state derivation
- `packages/shared/src/handoff/events.ts` — `EventKind` enum (16 kinds)
- `packages/shared/src/handoff/types.ts` — `Event`, `ProjectStatus`, `Actor`, `Issue`, `Subtask`
- `mcp/src/capture/events-log.ts` — ULID generator + append-only writer
- `mcp/src/capture/daemon.ts` — `startHandoffLoop`, `maybeFireInferNextStep`, `DaemonManager`
- `mcp/src/capture/handoff-sync.ts` — `runFlushCycle`, `runPullCycle`
- `mcp/src/capture/handoff-brief.ts` — `renderBriefFromCache`, `writeBrief`
- `mcp/src/cli/handlers.ts` — `HANDLERS` map (the source-of-truth subcommand registry)
- `mcp/src/cli/hook-dispatch.ts` — `dispatchHook`, `readHookPayloadFromStdin`, `hashCwd`, `getGitBasename`
- `mcp/src/cli/handoff-commands.ts` — `runHandoffCmd`, `runSetFocusCmd`, `runNoteCmd`, `runIssueCreate`, `runIssueResolve`, `runIssueSupersede`
- `mcp/src/cli/init.ts` — `runInit`, `installHooks`, `installSlashCommands`, `writeConfig`
- `backend/src/api/events-batch.ts` — `POST /api/events/batch` with auto-create and recompute
- `backend/src/api/project-status.ts` — `GET /api/projects/:id/status`
- `backend/src/lib/handoff-reducer.ts` — `recomputeProjectStatus`, `rowToEvent`
- `backend/src/lib/auth.ts` — `authMiddleware`, `hashApiKey`
- `backend/src/middleware/db.ts` — `dbMiddleware`

**Testing:**
- `mcp/test/` — vitest with `vitest.config.ts`. Subdirs mirror `src/` structure plus `e2e/`, `fixtures/`, `perf/`, `integration/`
- `backend/test/` — vitest with `@cloudflare/vitest-pool-workers` (real Workers runtime per test)
- `frontend/src/` — `*.test.ts` colocated with source (e.g. `lib/server/api.test.ts`, `lib/components/conversations/conversation-helpers.test.ts`)
- `packages/shared/test/handoff/` — reducer property tests + type checks

## Naming Conventions

**Files:**
- TypeScript: `kebab-case.ts` everywhere (`events-batch.ts`, `handoff-brief.ts`, `run-daemon.ts`, `hook-dispatch.ts`)
- Tests: `<source>.test.ts` (colocated for frontend `lib/`, in mirror `test/` tree for backend and mcp)
- Svelte: `PascalCase.svelte` for components (`AppShell.svelte`, `NavigationProgress.svelte`)
- SvelteKit reserved files: `+page.svelte`, `+page.server.ts`, `+layout.svelte`, `+layout.server.ts`, `+error.svelte`
- SQL migrations: `NNN_snake_case.sql` (zero-padded, monotonic)

**Directories:**
- Workspace-level: `kebab-case` (`durable-objects/`, `embedding-service/`)
- Inside source: `kebab-case` (`capture/`, `handoff/`, `editors/`)
- SvelteKit route groups: `(name)` parentheses (group, not URL segment)
- SvelteKit dynamic segments: `[name]` brackets (e.g. `projects/[name]`, `conversations/[id]`, `share/[token]`)

**Functions:**
- camelCase: `appendEvent`, `runFlushCycle`, `recomputeProjectStatus`, `resolveActor`, `hashApiKey`, `renderBriefFromCache`
- Hook handlers prefixed `run`: `runPostToolUseHook`, `runSessionStartHook`, `runUserPromptSubmitHook`
- Handler exports in `handoff-commands.ts` prefixed `run`: `runHandoffCmd`, `runSetFocusCmd`, `runIssueCreate`
- Argv parsers prefixed `parse`: `parseHandoffArgs`, `parseIssueCreateArgs`, `parseSetFocusArgs`

**Types:**
- PascalCase: `Event`, `Actor`, `ProjectStatus`, `Issue`, `Subtask`, `Reference`, `FileTouch`, `CommitRef`, `AppError`, `Env`
- Enums: PascalCase const objects (`EventKind`) with PascalCase keys (`SessionOpened`, `FileTouched`)
- Interfaces for shapes; type aliases for unions/primitives

**Variables and properties:**
- snake_case for DB columns + event payloads + on-the-wire JSON (`project_id`, `event_id`, `occurred_at`, `set_by`, `recent_files`)
- camelCase for internal JS/TS locals (`projectIds`, `apiKey`, `eventId`)
- DB row interfaces use snake_case (matching Postgres): `RowMutable`, `UserRow`, `InviteRow`

**Constants:**
- SCREAMING_SNAKE_CASE for module constants: `IDLE_THRESHOLD_MS`, `SKEW_LIMIT_MS`, `CWD_HASH_PATTERN`, `INVITE_TTL_MS`, `JOIN_URL_BASE`, `MAX_BRIEF_LINES`, `API_KEY_MAX_PER_USER`, `INJECTION_THRESHOLD_MS`

**Routes:**
- All authenticated HTTP under `/api/*` (`/api/events/batch`, `/api/projects/:id/status`, `/api/projects/:id/events`, `/api/projects/:id/invites`, `/api/invites/:token/accept`, `/api/insights`, ...)
- Unauthenticated under `/auth/*` (login, signup, oauth-callback)
- MCP transport mounted at `/mcp`
- Health check at `/health`

**IDs:**
- DB primary keys: UUID v4 (`gen_random_uuid()`)
- `event_id`: ULID (26 chars, lex-sortable). Crockford base32. Generated in `mcp/src/capture/events-log.ts:7`
- `session_id`: `s_<base36-millis>` from `mcp/src/hooks/session-start.ts:17` for hooks; `cli_<base36>` for CLI invocations (`mcp/src/cli/handlers.ts:109`); `daemon` literal for daemon-generated events
- Placeholder project IDs: `cwd_<sha1-hex[0..12]>` (matches regex `/^cwd_[a-f0-9]{12}$/` in `backend/src/api/events-batch.ts:7`)
- Issue IDs: `iss_<random-12-hex>` from `mcp/src/cli/handoff-commands.ts:64`
- Invite tokens: 24 random bytes → base64url (32 chars), `backend/src/api/invites.ts:6`
- API keys: hashed with SHA-256 (`hashApiKey` in `backend/src/lib/auth.ts:17`); stored as lowercase hex

## Where to Add New Code

**New CLI subcommand (e.g. `synapse my-new-thing <args>`):**
1. If it emits a new event kind, add the kind to `packages/shared/src/handoff/events.ts` (`EventKind` enum) — and extend the `reduce()` switch in `packages/shared/src/handoff/reducer.ts`.
2. Write the argv parser in `mcp/src/cli/handoff-arg-parse.ts` (`parseMyNewThingArgs(argv)`). Throw `Error("usage: ...")` on bad input.
3. Write the handler in `mcp/src/cli/handoff-commands.ts` if it's a handoff-event-emitting command: take `{ project_id, user_id, session_id, ...parsedArgs }`, call `appendEvent(projectDir(project_id), { ... })`, then `signalFlush()`.
4. Register in `mcp/src/cli/handlers.ts` `HANDLERS` map at the appropriate spot. Use `handlerContext()` to resolve `{project_id, user_id, session_id}` from cwd.
5. Add the help text line in `mcp/src/index.ts` `printHelp()` (look for the `bold("Capture")` / `bold("Workspace")` sections).
6. If exposed as a slash command, add an entry to `SLASH_COMMANDS` in `mcp/src/cli/init.ts:40` (frontmatter + shell-out body).
7. Tests: `mcp/test/cli/<name>.test.ts` for the handler, `mcp/test/unit/` if it has pure logic. Use `SYNAPSE_TEST_PROJECT_ID` env to override project resolution.

**New Claude Code hook event:**
1. Create `mcp/src/hooks/<kind>.ts` exporting `run<Kind>Hook(args)`. Always short-circuit on `process.env.SYNAPSE_DAEMON_SESSION === "1"`.
2. Add the `case` to `dispatchHook` in `mcp/src/cli/hook-dispatch.ts:18`. Update `readHookPayloadFromStdin` if a new field is needed.
3. Register the hook in `mcp/src/cli/init.ts` `HOOK_DEFS` (with optional `matcher` for PostToolUse-style filtering).
4. Tests: `mcp/test/hooks/<kind>.test.ts`.

**New handoff event kind:**
1. Add to `EventKind` enum in `packages/shared/src/handoff/events.ts:1`.
2. Add the `case EventKind.NewKind:` to the switch in `packages/shared/src/handoff/reducer.ts:41`. Mutate the relevant slot in `actors`/`subtasks`/`issues`/`next_step` accordingly.
3. Update `ProjectStatus` shape in `packages/shared/src/handoff/types.ts:80` if new fields appear in the output.
4. The backend reducer in `backend/src/lib/handoff-reducer.ts` automatically picks up changes via the `@synapse/shared` import — no backend change needed.
5. Tests: `packages/shared/test/handoff/reducer.test.ts`.

**New API route:**
1. Create `backend/src/api/<resource>.ts`. Export `const <resource> = new Hono<{ Bindings: Env }>();`. Apply `<resource>.use("*", authMiddleware);`.
2. Add `.get("/path", ...)` / `.post("/path", ...)` handlers. Use `c.get("db")` for Supabase, `c.get("user")` for the authenticated user, `c.get("tier")` for the tier.
3. Mount in `backend/src/index.ts` with `app.route("/api/<resource>", <resource>);` (line 73-87).
4. Validation: add a Zod schema to `backend/src/lib/validate.ts` `schemas` object; use `parseBody(c, schemas.x)` to parse.
5. DB queries: add helpers under `backend/src/db/queries/<resource>.ts` and re-export from `backend/src/db/queries/index.ts`.
6. Errors: `throw new NotFoundError("...")` or other `AppError` subclasses from `backend/src/lib/errors.ts`. They're caught by `app.onError`.
7. Tests: `backend/test/api/<resource>.test.ts` using `@cloudflare/vitest-pool-workers`.

**New Supabase migration:**
1. Pick the next sequential number — currently `017_project_invites.sql` is the latest, so the next is `018_<short_description>.sql` under `supabase/migrations/`.
2. Use `create table if not exists`/`alter table if not exists` for idempotency.
3. Enable RLS (`alter table x enable row level security;`) and add a `_member_read` policy mirroring `project_members` if it's per-project (see `supabase/migrations/015_handoff_layer.sql:66-79` for the pattern).
4. Writes go through the service-role Worker — do not add `_member_write` policies unless clients should write directly.
5. Apply: `cd backend && npm run db:migrate`.
6. Update `backend/src/db/types.ts` if the row shape is needed in TS, and add `db/queries/<x>.ts` helpers.

**New frontend route:**
1. Authenticated route: create `frontend/src/routes/(app)/<route>/+page.svelte` + `+page.server.ts`. The `+page.server.ts` exports `load: PageServerLoad` and calls `createApi(locals.token).x()`. `locals.user` is guaranteed present (the `(app)/+layout.server.ts` redirects to login otherwise).
2. Unauthenticated: place under `frontend/src/routes/(public)/` or directly under `frontend/src/routes/` (e.g. `share/[token]/`).
3. Dynamic segment: `[name]/` for slugs; access via `params.name` in the loader.
4. Components: add Svelte 5 components under `frontend/src/lib/components/<feature>/`. Import in pages via `$lib/components/<feature>/Foo.svelte`.
5. Types: extend frontend-specific types in `frontend/src/lib/types.ts` rather than mutating `@synapse/shared`.
6. API client method: add to `frontend/src/lib/server/api.ts`'s `createApi` builder. Test: `frontend/src/lib/server/api.test.ts`.

**New shared type:**
1. Add to `packages/shared/src/types.ts` for general domain types, `packages/shared/src/handoff/types.ts` for handoff-specific, or a new file under `packages/shared/src/`.
2. If creating a new file, add a subpath export to `packages/shared/package.json` "exports" map.
3. Re-export from `packages/shared/src/types.ts` if it should be available via the bare `@synapse/shared` import.

**New MCP tool (Streamable HTTP, dashboard-side):**
1. Create `backend/src/mcp/tools/<name>.ts` exporting `register<Name>Tools(server, env, getContext, db)`.
2. Inside, call `server.tool("tool_name", description, zodSchema, callback)`.
3. Wire into `backend/src/mcp/agent.ts:55` `init()` method.

**Utilities:**
- Shared cross-workspace helpers → consider whether a type belongs in `packages/shared/src/`
- Backend-only utility → `backend/src/lib/<name>.ts`
- MCP-only utility → `mcp/src/capture/` (for daemon/event-log) or `mcp/src/cli/` (for CLI helpers)
- Frontend-only helper → `frontend/src/lib/<name>.ts` (no `server/` prefix unless SSR-only)

## Special Directories

**`~/.synapse/` (runtime, not in repo):**
- Purpose: All local state created by `synapse init` and the daemon
- Contains: `config.json` (api_key, user_id), `device_id`, `daemon.healthcheck`, `daemon-flush-now` (signal file), `daemon-cc-profile.json`, `capture.pid`, `capture.log`, `daemon.log`, `project-map.json`, `projects/<project_id>/events.jsonl`, `projects/<project_id>/.watermark`, `projects/<project_id>/current_session.json`, `projects/<project_id>/last_injection.txt`, `projects/<project_id>/cache/project_status.json`, `projects/<project_id>/cache/brief.md`, `sessions/<session_id>.json` (legacy capture daemon)
- Override via `SYNAPSE_HOME` env var (used by tests)
- Generated: Yes (by hooks and daemon)
- Committed: No (not in repo)

**`~/.claude/commands/synapse/`:**
- Purpose: Slash command markdown files that shell out to `synapse <cmd>`. Read by Claude Code.
- Contains: `handoff.md`, `focus.md`, `issue.md`, `status.md`, `doctor.md`, `invite.md`
- Generated: Yes (by `synapse init` → `installSlashCommands` in `mcp/src/cli/init.ts:90`)
- Committed: No

**`mcp/dist/`, `frontend/dist/`, `backend/.wrangler/`:**
- Purpose: Build output / Wrangler local state
- Generated: Yes (`npm run build`, `wrangler dev`)
- Committed: No

**`.svelte-kit/`:**
- Purpose: SvelteKit generated app shell
- Generated: Yes (`svelte-kit sync`)
- Committed: No

**`supabase/`:**
- Purpose: Database schema source-of-truth + auth email templates
- Generated: No (hand-authored migrations)
- Committed: Yes

**`.github/`:**
- Purpose: GitHub Actions workflows
- Generated: No
- Committed: Yes

**`mcp/test/fixtures/capture/<tool>/`:**
- Purpose: Real captured session JSON for adapter unit tests (one folder per legacy adapter: claude-code, gemini, cursor, codex)
- Generated: No (committed fixtures)
- Committed: Yes

---

*Structure analysis: 2026-05-15*
