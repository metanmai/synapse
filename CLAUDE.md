# Synapse

Synapse is a context management tool that captures AI coding sessions and surfaces insights across projects. It has a web frontend (SvelteKit), a backend API (Cloudflare Workers), and an MCP server that exposes the workspace for read + `save_insight` writes.

CRITICAL REQUIREMENT: You MUST call `mcp__synapse__search()` or `mcp__synapse__list_insights()` BEFORE scanning the codebase, reading files, or doing any other work when the user asks about context, decisions, past work, architecture, or how something works. Synapse is the user's cross-session knowledge base. Skipping it means you will miss important context and waste time rediscovering things already documented. This is a BLOCKING step — do not proceed to codebase exploration until Synapse has been checked.

## MCP Server — Synapse Workspace

You have access to a **Synapse MCP server** that connects to the user's remote workspace. The server is read-only for the filesystem surface; the only write tool is `save_insight`, which is how agents record new knowledge.

### Tools

| Tool | Use | Example |
|------|-----|---------|
| `mcp__synapse__search` | Semantic search across all content | `search({ query: "authentication" })` |
| `mcp__synapse__list_insights` | List insights for a project | `list_insights({ project: "synapse" })` |
| `mcp__synapse__save_insight` | **Save a decision/learning/preference/architecture note/action item** | `save_insight({ project, type: "decision", summary, detail })` |
| `mcp__synapse__list_conversations` | List captured AI sessions for a project | `list_conversations({ project: "synapse" })` |
| `mcp__synapse__load_conversation` | Resume a session in a new agent | `load_conversation({ conversationId: "ses_..." })` |
| `mcp__synapse__ls` | List files in a historical directory | `ls({ path: "decisions" })` |
| `mcp__synapse__read` | Read a historical file | `read({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__history` | View version history | `history({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__tree` | Show full directory tree | `tree()` |

### When to use Synapse

- **When the user asks you to save, write, or remember something** — call `save_insight` with the appropriate type (`decision`, `learning`, `preference`, `architecture`, or `action_item`). This is the ONE write path.
- **When the user asks about past decisions, notes, or context** — `list_insights` or `search` first.
- **When starting work on this project** — `list_insights({ project: "synapse" })` and `search({ query: "<topic>" })` to load what's already known.

### Important

- The filesystem-style tools (`ls`, `read`, `tree`, `history`, `search`) browse **historical files** written by earlier versions of Synapse. Use them to discover prior context, but do not expect to write new files — there is no `write` tool.
- New knowledge flows through two paths:
  1. **`save_insight`** — agent-initiated, structured knowledge (what this CLAUDE.md expects you to use)
  2. **Capture daemon** — records AI coding sessions automatically → captured as conversations → compacted into summaries server-side
- Paths are like filesystem paths: `folder/subfolder/file.md`

## Synapse as Default Context Layer

Synapse REPLACES local filesystem for all context operations. Do NOT save context, notes, decisions, summaries, or memory to local files. Use `save_insight` for everything worth remembering.

### Session Start
- Check if the Synapse MCP tools are available (try `list_insights({ project: "synapse" })`). If they're not connected:
  1. Check if `.mcp.json` exists in the current project directory with a synapse server config.
  2. If not, ask the user for their Synapse API key and create `.mcp.json` with: `{ "mcpServers": { "synapse": { "command": "npx", "args": ["synapsesync"], "env": { "SYNAPSE_API_KEY": "<key>" } } } }`
  3. Tell the user to restart Claude Code to pick up the MCP server.
- Once connected, check Synapse for existing context relevant to the current task: `list_insights` or `search`

### MANDATORY: Read-Through Pattern (Check Synapse → Fallback → Save Insight)
Synapse uses a **read-through caching pattern**. Follow this flow for EVERY task:

1. **READ from Synapse first** — `search({ query: "<topic>" })` or `list_insights({ project: "<name>" })`. This is not optional. Do this in parallel with starting other work if possible — don't block the workflow.
2. **Cache HIT** — Synapse has the context → use it, done.
3. **Cache MISS** — Synapse has no results → fall back to codebase, git history, or other sources. Continue working — don't pause.
4. **SAVE INSIGHT (non-blocking)** — After finding the answer or making a decision, save it as an insight in the background alongside your next response or tool call. Never make the user wait for the save.

Save-insight examples (what to capture after a cache miss or during work):
- **Made a design/technical decision** → `save_insight({ project, type: "decision", summary: "Chose X over Y", detail: "..." })`
- **Discovered how a subsystem works** → `save_insight({ project, type: "architecture", summary: "<system> works by ...", detail: "..." })`
- **Learned a non-obvious fact** → `save_insight({ project, type: "learning", summary: "...", detail: "..." })`
- **Noted a user preference** → `save_insight({ project, type: "preference", summary: "...", detail: "..." })`
- **Identified follow-up work** → `save_insight({ project, type: "action_item", summary: "...", detail: "..." })`
- **Subagent returned results** → Save any important decisions the subagent made (subagents can't access Synapse).
- **User says "remember this"** → Always a `save_insight`, never local files.

If an insight already exists but is outdated, there is no update tool — save a new insight that supersedes it. The dashboard will show the most recent.

### What NOT to Save as Insights
- Source code (that belongs in git)
- Temporary debugging output
- Verbatim conversation transcripts (the capture daemon handles that)
- Anything the user explicitly asks to keep local

### Scope Control
The user can control scope by saying things like:
- "Save this locally" — use local filesystem instead
- "Don't save this" — skip saving
- "Save this to synapse as a <type>" — use the specified insight type
- If no scope is specified, default to `save_insight` with an appropriate type.

## `<synapse-brief>` tag recognition

If your first user message contains a `<synapse-brief>` ... `</synapse-brief>` block, that's project orientation auto-injected by the Synapse SessionStart hook. Treat as:
- Trusted context about the current project (summary, recent conversations, insights)
- NOT a tool result — you were not a participant in prior sessions. Do not pretend to remember specific statements.
- A prompt to briefly acknowledge the current state and ask the user what they want to do next.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Synapse**

Synapse captures Claude Code coding sessions locally via filesystem hooks, syncs them to a backend, and materializes a per-project "handoff brief" so the next session resumes with full context. It targets developers running Claude Code (and adjacent MCP-capable tools like Cursor and Windsurf) who want session context to persist across resumes, machines, and collaborators. Today the loop works end-to-end on disk; cloud sync is in flight.

**Core Value:** **The next session knows where the last one left off.** Everything else can degrade — billing, dashboard, multi-tool integrations — but the capture → daemon → backend → brief loop must work reliably. If a developer can't trust that this conversation will be findable, summarizable, and useful in the next session, nothing else matters.

### Constraints

- **Timeline**: Launch by **Friday 2026-05-29** — 10 days from today (2026-05-19). Was originally 5 days targeting EoW; expanded on 2026-05-19 to accommodate cross-user collaboration and token-brokering scope additions. Still tight; drives ruthless prioritization within the new window
- **Solo developer**: One person executing. No team coordination overhead, but attention is the bottleneck
- **Tech stack pinned**: TypeScript across all four workspaces (mcp, backend, frontend, packages/shared). No language switches this milestone. Cloudflare Workers (backend) + Cloudflare Pages or Vercel (frontend) + Supabase Postgres
- **Backend deploy is manual**: No auto-deploy GitHub Action; `wrangler deploy` runs from a machine with the Cloudflare API token. Production can drift from main if deploy is forgotten (BUGS.md #10) — discipline-based
- **Corporate network proxy**: Some npm / pypi / npx egress is blocked by Netskope. Affects install paths (`npx synapsesync` fails on this network — REQ-BUG-03). Bypass requires tethering or a different network
- **Pre-push hook runs full verify** (`npm run lint && npm run typecheck && npm run test`) on every push — slows pushes ~25s but catches regressions
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 — backend (`backend/`), MCP package (`mcp/`), shared types (`packages/shared/`)
- TypeScript 5.0.x — frontend (`frontend/`, baseline pinned in `frontend/package.json`)
- Svelte 5.54.0 — frontend UI (`frontend/src/routes/`, `frontend/src/lib/components/`)
- SQL (Postgres) — Supabase migrations (`supabase/migrations/`)
- Python 3.12 — optional embedding sidecar (`embedding-service/app.py`, `embedding-service/Dockerfile`)
- Plist XML / systemd unit text — emitted by `mcp/src/capture/os-service.ts` for launchd / systemd registration; no XML runtime dependency.
## Runtime
- Compatibility date: `2025-04-01` (`backend/wrangler.jsonc:5`)
- Compatibility flags: `nodejs_compat` (`backend/wrangler.jsonc:6`)
- Durable Object classes: `SynapseAgent` (MCP server), `CompactionScheduler` (alarm-driven LLM summarisation) — `backend/wrangler.jsonc:7-28`
- Cron triggers: `*/5 * * * *` (Google sync), `0 3 * * *` (daily aggregation) — `backend/wrangler.jsonc:30-32`
- Custom domain route: `api.synapsesync.app` (`backend/wrangler.jsonc:29`)
- Node.js (ESM) — `"type": "module"` in `mcp/package.json`
- Minimum Node version: 22 (CI matrix in `.github/workflows/ci.yml:23`, `publish.yml:24`); `@types/node` pinned to `^22.0.0` in `mcp/package.json:39`.
- Distributed as the `synapsesync-mcp` npm package; `bin/synapsesync-mcp` points at `dist/index.js` with a shebang patched in by `mcp/scripts/add-shebang.mjs`.
- Long-running daemon process registered via launchd (`~/Library/LaunchAgents/app.synapsesync.daemon.plist`) on macOS or systemd user service on Linux — see `mcp/src/capture/os-service.ts:46-64`.
- SvelteKit 2.55.0 on Vite 6 — see `frontend/package.json:18-26`.
- Adapter: `@sveltejs/adapter-auto` (`frontend/svelte.config.js:1`) — production target is Cloudflare Pages (`https://synapse-7mq.pages.dev`, also `https://synapsesync.app` aliased via CORS allowlist in `backend/src/index.ts:35`).
- Python 3.12 slim Docker image (`embedding-service/Dockerfile:1`).
- FastAPI 0.128.8 + Uvicorn 0.39.0 (`embedding-service/requirements.txt:13-14`).
- Model pre-downloaded at build time: `nomic-ai/nomic-embed-text-v1.5` (`embedding-service/Dockerfile:9`).
- npm with workspaces — `"workspaces": ["packages/*", "backend", "frontend", "mcp"]` (`package.json:4`).
- Lockfile: `package-lock.json` present at repo root.
- CI uses `npm install` on Node 22 (`.github/workflows/ci.yml:25-26`).
## Frameworks
- Hono 4.12.8 — HTTP router for the Worker (`backend/src/index.ts:1`, mounted in `backend/package.json:22`). All routes are `new Hono<{ Bindings: Env }>()`.
- SvelteKit 2.55 — frontend framework (`frontend/package.json:17`).
- Svelte 5.54 (runes mode) — UI components (`frontend/package.json:21`).
- Tailwind CSS 4.2.2 — styling, wired via `@tailwindcss/vite` plugin (`frontend/vite.config.ts:2`).
- MCP SDK — `@modelcontextprotocol/sdk` 1.27.1 in `mcp/`, `^1.26.0` in `backend/` (`mcp/package.json:34`, `backend/package.json:19`).
- Cloudflare `agents` package 0.7.9 — provides `McpAgent` base used by `backend/src/mcp/agent.ts:2`. The Streamable HTTP MCP transport is mounted at `/mcp` via `SynapseAgent.serve("/mcp").fetch` (`backend/src/index.ts:90`).
- Supabase JS 2.99.2 — backend and frontend (`backend/package.json:21`, `frontend/package.json:30`).
- Supabase SSR 0.9.0 — frontend cookie-based session (`frontend/package.json:29`).
- FastAPI 0.128.8 + Pydantic 2.12.5 — embedding sidecar (`embedding-service/requirements.txt:13,15`).
- Vitest 4.1.x — used in `backend/` (with `@cloudflare/vitest-pool-workers` 0.13.2), `frontend/`, and `mcp/` (`backend/vitest.config.ts`, `frontend/vitest.config.ts`, `mcp/vitest.config.ts`).
- `@cloudflare/vitest-pool-workers` runs backend tests inside a simulated Workers runtime against `wrangler.jsonc` (`backend/vitest.config.ts:1-10`).
- `svelte-check` 4.4.5 — Svelte typechecking (`frontend/package.json:11`).
- MCP test suite organised under `mcp/test/{unit,integration,e2e,capture,hooks,cli,perf}/` (`mcp/vitest.config.ts:7-15`). E2E runs gated by `TEST_E2E=1` in `mcp/package.json:12`.
- Wrangler 4.75 — Worker dev/deploy, secret management (`backend/package.json:31`). `wrangler dev --test-scheduled` enables cron testing locally (`backend/package.json:6`).
- Vite 6.0 — frontend dev server / build (`frontend/package.json:25`).
- TypeScript 5.9.3 (backend, mcp) / 5.0.x (frontend) — strict mode everywhere.
- Biome 1.9.4 — single repo-wide lint + format tool (`biome.json`, `package.json:18`). Runs across the monorepo via `biome check .`.
## Key Dependencies
- `@modelcontextprotocol/sdk` (1.27.1 mcp / ^1.26 backend) — MCP protocol implementation. Stdio transport in the legacy mcp CLI (`mcp/src/index.ts:5`); Streamable HTTP transport on the backend via `agents/mcp` (`backend/src/mcp/agent.ts:2`).
- `@supabase/supabase-js` 2.99.2 — auth (`backend/src/lib/auth.ts:43`) and database client (`backend/src/db/client.ts`). Server-side uses **service role** key; frontend uses **anon** key via `@supabase/ssr`.
- `hono` 4.12.8 — every Worker route is a `Hono<{ Bindings: Env }>` instance with `cors()`, custom rate-limit, and per-route `dbMiddleware` (`backend/src/index.ts:31-49`).
- `agents` 0.7.9 — Cloudflare-published `McpAgent` base class. Note the inline cast `type AnyMcpAgent = any` in `backend/src/mcp/agent.ts:19` documents a nominal-type mismatch between the agent's bundled SDK copy and the top-level `McpServer` — biome `noExplicitAny` is disabled for this single file (`biome.json:40-48`).
- `zod` — schema validation. **Hard-pinned to 4.3.6** in `mcp/package.json:36`; backend uses `^4.3.6` (`backend/package.json:24`). All MCP tool inputs are zod-validated (`mcp/src/index.ts:6`, `backend/src/lib/validate.ts`).
- `chokidar` ^5 — filesystem watcher for the capture daemon (`mcp/src/capture/watcher.ts:3`). Watches per-tool session logs to materialise `CapturedSession` records.
- `@clack/prompts` ^0.11 — interactive CLI prompts (wizard, capture subcommands) — `mcp/src/index.ts:8`, `mcp/src/cli/wizard.ts:5`.
- `fflate` 0.8.2 — zip in/out for project export/import (`backend/src/lib/export.ts:1`, `backend/src/lib/import.ts:2`).
- `marked` 17.0.5 + `dompurify` 3.3.3 — frontend markdown rendering (`frontend/package.json:33-34`).
- `mcp/package.json` pins **exact** versions for `@modelcontextprotocol/sdk` (1.27.1) and `zod` (4.3.6) — no caret — because the MCP SDK's zod-schema serialisation is sensitive to zod minor versions.
- `backend/package.json` uses `^` ranges for the same packages — they can drift between the published MCP CLI and the deployed Worker; coordinate updates carefully.
- `embedding-service/requirements.txt` hard-pins every Python dep to exact versions (`==`) to keep the Docker layer deterministic and avoid model-incompatible torch/transformers combinations (`embedding-service/requirements.txt:1-15`).
- `wrangler` ^4.75 — Worker deploy + cron simulation (`backend/package.json:31`).
- `@cloudflare/vitest-pool-workers` ^0.13.2 — runs backend tests inside the Workers runtime against `wrangler.jsonc` (`backend/vitest.config.ts:1-10`).
- `@cloudflare/workers-types/experimental` — typed via `"types"` in `backend/tsconfig.json:7`.
## Configuration
- Backend env interface: `backend/src/lib/env.ts:1-49` enumerates all bindings: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `CREEM_API_KEY`/`WEBHOOK_SECRET`/`PRO_PRODUCT_ID`, `EMBEDDING_SERVICE_URL/KEY`, `COMPACTION_LLM_KEY/MODEL`, plus tier-limit overrides.
- All secrets set via `wrangler secret put` — `backend/wrangler.jsonc:33-37` explicitly warns against putting them in `vars` (would zero out on deploy).
- Only non-secret var inline: `COMPACTION_LLM_MODEL = "claude-haiku-4-5-20251001"` (`backend/wrangler.jsonc:39`).
- Local dev: copy `.dev.vars.example` → `backend/.dev.vars` (file exists at repo root: `/Users/Tanmai.N/Documents/synapse/.dev.vars.example`).
- Frontend env: `frontend/.env.example` → `frontend/.env` with `API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. The frontend reads these via `$env/dynamic/private` (`frontend/src/lib/server/auth.ts:1`, `frontend/src/lib/server/api.ts:1`).
- MCP user config: `~/.synapse/config.json` written by `synapse init` (`mcp/src/cli/init.ts:121-132`); houses `api_key` and the opt-in `daemon.ai_enabled` flag.
- MCP runtime env: `SYNAPSE_API_KEY` (required for MCP mode — `mcp/src/index.ts:234`), `SYNAPSE_SOURCE` (defaults `claude` — `mcp/src/index.ts:235`), `SYNAPSE_HOME` (overrides `~/.synapse` — `mcp/src/capture/handoff-paths.ts:5`), `SYNAPSE_TEST_PROJECT_ID` (tests).
- Backend: `npm run build` is a no-op for the Worker (Wrangler builds on `deploy`); `typecheck` runs `tsc --noEmit` (`backend/package.json:8-9`).
- MCP: `tsc` emits `dist/`, then `scripts/add-shebang.mjs` prepends `#!/usr/bin/env node` and `chmod 0755` (`mcp/package.json:10`, `mcp/scripts/add-shebang.mjs`).
- Frontend: `vite build` (`frontend/package.json:7`).
- Root: `npm run build` chains lint + workspace builds (`package.json:8`). `npm run verify` chains lint + typecheck + test (`package.json:12`).
- `frontend/.env` (exists; secrets).
- `backend/.dev.vars` is not present locally; `.dev.vars.example` is committed.
## Platform Requirements
- Node 22.x (CI baseline; matches `@types/node` ^22 in `mcp/`). `@types/node` is `^25.5.0` in `backend/` — CI still uses Node 22, so do not assume Node 25 runtime APIs.
- npm with workspaces (npm 8+).
- For the daemon: macOS (launchd) or Linux (systemd user services). Windows is partially supported by `os-service.ts` (chmod is wrapped in try/catch in `add-shebang.mjs`).
- Supabase CLI (for `supabase db push` via `backend/package.json:11`'s `db:migrate`).
- Optional: Docker for the embedding sidecar.
- Cloudflare Workers (`backend/`, deployed via `wrangler deploy`).
- Cloudflare Pages (`frontend/`, served from `synapse-7mq.pages.dev` and aliased to `synapsesync.app`).
- Supabase managed Postgres + Auth + Storage (RLS enabled on core tables — `supabase/migrations/001_initial_schema.sql:79-84`).
- Optional Docker-deployed embedding service (any HTTPS host; configured via `EMBEDDING_SERVICE_URL` env).
- The MCP package is published to npm as `synapsesync-mcp` from `.github/workflows/publish.yml` (trusted publishing with `--provenance`).
## Build & Test Toolchain Summary
| Tool | Version | Where | Role |
|------|---------|-------|------|
| Biome | 1.9.4 | root | Lint + format across all workspaces (`biome.json`). Svelte files lint-disabled, `backend/src/mcp/agent.ts` has `noExplicitAny: off` override. |
| TypeScript | 5.9.3 (backend, mcp), 5.0.x (frontend) | per workspace | Strict mode; backend uses `bundler` moduleResolution, mcp uses `Node16`. |
| Vitest | 4.1.x | backend, frontend, mcp | Single runner, but pool differs: backend uses `@cloudflare/vitest-pool-workers`, frontend uses `node`, mcp uses `node` with explicit `test/{unit,integration,e2e,...}` includes. |
| Wrangler | 4.75 | backend | Worker dev, deploy, secret management, cron emulation. |
| svelte-check | 4.4.5 | frontend | Svelte/TS check. |
| Supabase CLI | (external) | supabase/ | `supabase db push` invoked via `backend/npm run db:migrate`. |
| `add-shebang.mjs` | local script | mcp/scripts | Post-tsc patch for the `synapse` binary. |
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- `kebab-case.ts` for all TypeScript modules — verified across `backend/src/api/events-batch.ts`, `mcp/src/capture/handoff-sync.ts`, `mcp/src/cli/handoff-arg-parse.ts`, `frontend/src/lib/server/api.ts`.
- `kebab-case.test.ts` for unit/integration tests — e.g. `mcp/test/cli/cli-dispatcher.test.ts`, `backend/test/lib/errors.test.ts`.
- `<thing>.e2e.test.ts` or `e2e/` subdirectory for end-to-end tests — e.g. `mcp/test/e2e/handoff.e2e.test.ts`, `mcp/test/e2e/api-roundtrip.test.ts`.
- `<thing>.bench.test.ts` for performance benchmarks — e.g. `mcp/test/perf/hook-latency.bench.test.ts`.
- `+page.svelte` / `+page.server.ts` / `+layout.svelte` for SvelteKit routes — e.g. `frontend/src/routes/login/+page.server.ts`.
- `camelCase` — `runHandoffCmd`, `parseHandoffArgs`, `resolveActor`, `appendEvent`, `hashApiKey`, `findUserByApiKeyHash`.
- Top-level handlers exported by name and re-collected into dispatch maps (see `mcp/src/cli/handlers.ts` HANDLERS, `backend/src/lib/validate.ts` schemas).
- `camelCase` for locals and module-level — `apiKeyHash`, `projectId`, `tanmaiHome`.
- `SCREAMING_SNAKE_CASE` for module-level constants — `API_URL` (`mcp/src/cli/config.ts`), `EMBEDDING_TIMEOUT_MS` (`backend/src/lib/constants.ts`), `HOOK_BIN`, `SLASH_COMMANDS`, `HOOK_DEFS` (`mcp/src/cli/init.ts`), `FAKE_UUID` (test files), `ENCODING` (`mcp/src/capture/events-log.ts`).
- Backend env var keys use `SCREAMING_SNAKE_CASE` and are typed via the `Env` interface in `backend/src/lib/env.ts`.
- `PascalCase` interfaces and type aliases — `Event`, `Actor`, `Project`, `Env`, `HandlerContext`, `ApiError`, `AppError`, `NotFoundError`, `EmbeddingConfig`, `Subtask`.
- `EventKind` (`packages/shared/src/handoff/events.ts`) uses `PascalCase` for both the type name and the const-object member keys, with `snake_case` string values that match wire format: `EventKind.NextStepSet = "next_step_set"`.
- Wire-format / DB-row fields use `snake_case` (`event_id`, `project_id`, `attached_to`, `occurred_at`, `received_at`) and are preserved through to JSON.
- Re-export types via barrel files: `packages/shared/src/types.ts` re-exports `./conversations` and `./insights`; `packages/shared/package.json` exports `./handoff/types.js`, `./handoff/events.js`, `./handoff/reducer.js` as subpaths.
## Code Style
- Config: `biome.json` at the repo root, version `^1.9.0` (see root `package.json`).
- `formatter`: `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 120`.
- `organizeImports.enabled: true` — Biome auto-orders imports on save / `biome check --write`.
- `linter.rules.recommended: true` plus repo-specific overrides:
- Ignored paths: `node_modules`, `dist`, `build`, `.svelte-kit`, `.wrangler`, `*.min.js`.
- Overrides:
- Only inline ignores, scoped per-rule: `// biome-ignore lint/performance/noDelete: real delete required` (used wherever an env-var or property must actually be removed — see `mcp/test/cli/cli-dispatcher.test.ts:96-99`, `mcp/test/e2e/handoff.e2e.test.ts:24-25`).
- `// biome-ignore lint/suspicious/noExplicitAny: <reason>` for the few `any` casts in test plumbing (`mcp/test/cli/cli-dispatcher.test.ts:34-49`).
- `// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Supabase query chains` in `backend/test/db/mock-supabase.ts:47`.
- Every ignore carries a real reason — never a bare `// biome-ignore`.
## Import Organization
- `mcp` (Node ESM, `tsconfig` `module: Node16`) — relative imports MUST include `.js` extension even when the source is `.ts`: `import { resolveActor } from "../capture/actor.js"`. See every file under `mcp/src/`.
- `backend` (Cloudflare Workers, `moduleResolution: bundler`) — relative imports omit extensions: `import { authMiddleware } from "../lib/auth"`. See `backend/src/index.ts`.
- `frontend` (Vite, `moduleResolution: bundler`) — no extension on relative imports.
- `packages/shared` exports subpaths as `.js` aliases (see `packages/shared/package.json` `exports`), so external consumers always import with `.js`.
- Frontend (`frontend/vitest.config.ts`):
- Backend / MCP — no path aliases. Relative paths only.
## Environment Variables
- All env vars declared as fields on the `Env` interface in `backend/src/lib/env.ts`. The Hono app uses `new Hono<{ Bindings: Env }>()` (`backend/src/index.ts:28`) so `c.env.<KEY>` is statically typed.
- Required vars throw at first use (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRO_PRODUCT_ID`).
- Optional vars use the `envOr` / `envList` helpers in `backend/src/lib/env.ts` — never read `c.env.X ?? "default"` inline.
- Read with `import { env } from "$env/dynamic/private"` and access fields off `env` (e.g. `env.API_URL`, `env.SUPABASE_URL`, `env.SUPABASE_ANON_KEY`). See `frontend/src/lib/server/api.ts:1-3` and `frontend/src/lib/server/auth.ts:1-8`.
- Never use `$env/static/private` for runtime values — the static form locks values to build time, which broke deploys before the v1.1 switch.
- `$env/static/private` is still mocked in tests (`frontend/src/test-mocks/env-private.ts`) for any legacy callers, but new code uses `$env/dynamic/private`.
- Missing-value handling: callers throw with a precise message — see `frontend/src/lib/server/api.ts:15-17` (`"API_URL is not configured. Set it in your environment variables."`) and `frontend/src/lib/server/auth.ts:8-9`.
- Read directly: `process.env.SYNAPSE_HOME`, `process.env.SYNAPSE_API_KEY`, `process.env.SYNAPSE_DAEMON_SESSION`, `process.env.SYNAPSE_TEST_PROJECT_ID`.
- Resolved through helpers when the value drives a filesystem path:
- Constants live in `mcp/src/cli/config.ts` (e.g. `API_URL = "https://api.synapsesync.app"`).
## Error Handling
- Base: `AppError(message, status = 500, code = "INTERNAL_ERROR")`.
- Subclasses set status + code: `NotFoundError` (404 / `NOT_FOUND`), `UnauthorizedError` (401 / `UNAUTHORIZED`), `ForbiddenError` (403 / `FORBIDDEN`), `ConflictError` (409 / `CONFLICT`).
- Route handlers `throw new <Error>("message")` — never `return c.json({error}, 4xx)` inline. Central `app.onError` in `backend/src/index.ts:51-65` serialises `AppError` into `{ error, code }` with the right status; unknown errors become 500 with `INTERNAL_ERROR` and a console.error.
- Validation errors come from `parseBody(c, schema)` in `backend/src/lib/validate.ts` which throws `new AppError(issues, 400, "VALIDATION_ERROR")` when a Zod schema fails. All POST/PATCH handlers funnel through this.
- Test the contract by hitting endpoints with `worker.fetch` and asserting status + `body.error` + `body.code` (see `backend/test/lib/errors.test.ts:14-18`).
- Used by every `+page.server.ts` load/action and any server-side fetch.
- Constructor: `ApiError(status: number, message: string)` — same shape as backend, no `code` field (status is enough for branch logic in the load function).
- Network failures map to `ApiError(503, "Cannot reach API at ...")`; missing `API_URL` maps to `ApiError(500, "API_URL is not configured...")`; non-2xx responses lift `body.error` + optional `body.detail` into the message.
- Always `throw`, never return. The SvelteKit `+error.svelte` boundary handles rendering.
- CLI arg parsers throw with the usage line: `throw new Error('usage: synapse handoff "<text>"')` (`mcp/src/cli/handoff-arg-parse.ts:16`). The dispatcher in `mcp/src/cli/handlers.ts` catches and writes to stderr with exit code 1 (see `cli-dispatcher.test.ts:74-83`).
- Hook handlers (`runPostToolUseHook`, `runSessionStartHook`) are fire-and-forget — they short-circuit on guard env vars (`SYNAPSE_DAEMON_SESSION === "1"`) and otherwise append events without throwing on transient FS errors.
- Network operations (sync, invite) throw on non-2xx; callers in `mcp/src/cli/invite.ts` print a one-line error and exit non-zero.
- `"Cannot reach API at ${API_URL}${path}: ${err.message}"` not `"Network error"`.
- `"No user found with email ${email}"` not `"Not found"`.
- `"invite failed: ${status}"` not `"Request failed"`.
## Logging
- `[api]` for outbound HTTP from the SvelteKit server-side fetcher (`frontend/src/lib/server/api.ts:29`).
- `[auth]` for auth middleware (`backend/src/lib/auth.ts:49,53,58,72`).
- `[embeddings]` for the embedding-service client (`backend/src/lib/embeddings.ts:43,50`).
- `[error]` for the global error handler (`backend/src/index.ts:55`).
- Network / external service failures — log full status + body once.
- Auth misses that aren't user error (e.g. JWT verifies but no row in `public.users`) — `console.error` with a remediation hint.
- Never log secrets, full API keys, or full JWTs. Hash + truncate if needed.
## Function Design
- Backend route handlers return `c.json(payload, status)` — never raw `Response`.
- MCP CLI commands return `Promise<void>` and signal via stdout/stderr + appendEvent side-effects.
- Pure helpers (reducer, parsers) return typed result objects; throwing for invalid input.
- Dependency-injection for testability: `embedTexts(texts, type, config, fetchFn = globalThis.fetch)` in `backend/src/lib/embeddings.ts:18-23` accepts an injectable `fetchFn` so tests pass `vi.fn()` directly without `vi.stubGlobal`.
## Module Design
- Named exports only — no `export default` except where a framework requires it (`backend/src/index.ts:96-105` exports a default fetch handler for Cloudflare Workers; SvelteKit `+page.server.ts` exports named `load` / `actions`).
- Interfaces and types are exported alongside the functions that consume them (`interface InitArgs` in `mcp/src/cli/init.ts:6-9`, `interface ParsedHandoff` in `mcp/src/cli/handoff-arg-parse.ts:10-12`).
- `packages/shared/src/types.ts` is the canonical barrel — re-exports every domain type via `export type { ... } from "./insights"` and `export type { ... } from "./conversations"` (see `packages/shared/src/types.ts:77-94`).
- Submodule barrels per feature: `packages/shared/src/handoff/types.ts`, `packages/shared/src/handoff/events.ts`, `packages/shared/src/handoff/reducer.ts` exposed individually through `packages/shared/package.json` `exports` (`./handoff/types.js`, etc.) — consumers `import` the exact submodule they need, no transitive bloat.
- MCP and backend do not maintain barrel files — every consumer imports directly from the source module.
- `mcp/src/cli/handlers.ts` defines `HANDLERS: Record<string, (args: string[]) => Promise<void>>` (see line 129) — the entry point in `mcp/src/index.ts` looks up the cmd in the map. Tests bypass the entry-point bootstrap and call `HANDLERS[cmd]` directly (`mcp/test/cli/cli-dispatcher.test.ts:69-75`).
- `backend/src/lib/validate.ts` exports a `schemas` object keyed by operation name (`schemas.createProject`, `schemas.addMember`, etc., lines 21-167). Route handlers call `parseBody(c, schemas.<op>)` rather than re-declaring Zod shapes inline.
## TypeScript Configuration
- `strict: true`, `skipLibCheck: true`, `esModuleInterop: true` (where applicable), `isolatedModules: true`, `forceConsistentCasingInFileNames: true`, `resolveJsonModule: true`.
- `mcp/tsconfig.json` — `target: ES2022`, `module: Node16`, `moduleResolution: Node16`, emits to `dist/` with `declaration: true`. Drives the `.js` extension requirement on relative imports.
- `backend/tsconfig.json` — `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `noEmit: true`, types: `["@cloudflare/vitest-pool-workers/types", "@cloudflare/workers-types/experimental"]`.
- `frontend/tsconfig.json` — extends `./.svelte-kit/tsconfig.json`, adds `allowJs: true`, `checkJs: true`, `sourceMap: true`.
- `packages/shared/tsconfig.json` — `noEmit: true`, source is consumed directly via the workspace `main: "./src/types.ts"` field.
## Pre-push Verification
#!/bin/sh
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- **Pure reducer.** `reduce(events, project_id, { now? }) → ProjectStatus` in `packages/shared/src/handoff/reducer.ts` has zero side effects and is identical on client and server. Same events in → same status out.
- **Local-first event log.** Hooks/CLI append to `~/.synapse/projects/<project_id>/events.jsonl` without network I/O. The daemon flushes batches; nothing else mutates the log.
- **LWW + clock-skew guard.** `orderKey()` in `reducer.ts` sorts by `occurred_at`, but falls back to `received_at` when `occurred_at - now > 5 min`. Backend mirrors this in `events-batch.ts` (`SKEW_LIMIT_MS = 5 * 60 * 1000`).
- **Idempotency by event_id.** ULIDs (lex-monotonic, time-sortable) are the dedup key. The batch endpoint uses `upsert(..., { onConflict: "event_id", ignoreDuplicates: true })`.
- **Materialized cache on the server.** `handoff_project_status` is a single-row-per-project snapshot keyed `project_id`. Recomputed synchronously on every batch insert.
- **Pull-then-render on the client.** Daemon writes `~/.synapse/projects/<id>/cache/project_status.json` and `cache/brief.md`; the SessionStart hook reads `brief.md` and emits it to stdout in a `<synapse-brief>` block.
- **Auto-project-creation via `cwd_<hash>` placeholders.** First-run agents append events under `cwd_<sha1[0..12]>` IDs; the batch endpoint resolves them to canonical project UUIDs and returns the mapping in `canonical_project_ids`.
## Layers
- Purpose: Common domain types across mcp, backend, frontend
- Location: `packages/shared/src/`
- Contains: `handoff/types.ts` (Event/ProjectStatus/Actor/Issue/Subtask), `handoff/events.ts` (`EventKind` enum), `handoff/reducer.ts` (the pure reducer), `types.ts` (User/Project/Entry), `insights.ts`, `conversations.ts`
- Depends on: nothing (no runtime deps in `package.json`)
- Used by: `mcp` and `backend` via `import { Event } from "@synapse/shared/handoff/types.js"`; `frontend` via `import { User } from "@synapse/shared"`
- Purpose: Local event capture, daemon loop, brief rendering, OS service install
- Location: `mcp/src/capture/`
- Contains: append-only event log writer, daemon manager, flush/pull cycle, brief renderer, heuristic synth fallback, claude-haiku spawn helper, capture daemon for prior AI-session adapters
- Depends on: `@synapse/shared/handoff/*`, `node:fs`, `node:crypto`, `node:child_process`
- Used by: hook handlers, CLI handoff commands, daemon entry point
- Purpose: Translate Claude Code hook events into handoff events
- Location: `mcp/src/hooks/`
- Contains: one file per hook kind — `session-start.ts`, `user-prompt-submit.ts`, `post-tool-use.ts`, `pre-compact.ts`, `session-end.ts`, `subagent-stop.ts`
- Depends on: `capture/events-log.ts`, `capture/actor.ts`, `capture/handoff-paths.ts`
- Used by: `cli/hook-dispatch.ts` (single switch statement)
- Purpose: User-facing `synapse <cmd>` subcommands and editor-config orchestration
- Location: `mcp/src/cli/`
- Contains: `handlers.ts` (HANDLERS map), `handoff-commands.ts` (handoff/focus/note/issue), `hook-dispatch.ts`, `init.ts`, `invite.ts`, `run-daemon.ts`, `status.ts` (doctor), `wizard.ts`, `editors/*` (claude-code/cursor/windsurf/vscode config writers)
- Depends on: `capture/*`, `hooks/*`, `@synapse/shared`
- Used by: `mcp/src/index.ts` entry point
- Purpose: HTTP endpoints, all under `/api/*` except `/auth/*` and `/mcp`
- Location: `backend/src/api/`
- Contains: one Hono sub-app per resource (`events-batch.ts`, `project-status.ts`, `project-events.ts`, `projects.ts`, `projects-resolve.ts`, `invites.ts`, `insights.ts`, `conversations.ts`, `compaction.ts`, `context.ts`, `share.ts`, `sync.ts`, `auth.ts`, `account.ts`, `admin.ts`, `billing.ts`)
- Depends on: `lib/auth.ts` (middleware), `lib/handoff-reducer.ts`, `db/queries/*`, `middleware/db.ts`
- Used by: `backend/src/index.ts` `app.route()` calls
- Purpose: Cross-cutting helpers
- Location: `backend/src/lib/`
- Contains: `auth.ts` (auth middleware + `hashApiKey`), `handoff-reducer.ts` (server wrapper around shared reducer), `errors.ts` (`AppError`/`NotFoundError`/`UnauthorizedError`/`ForbiddenError`/`ConflictError`), `idempotency.ts`, `rate-limit.ts`, `validate.ts`, `tier.ts`, `env.ts`, `constants.ts`, `creem.ts`, `embeddings.ts`, `export.ts`, `import.ts`, `storage.ts`, `llm/*`, `adapters/*`
- Depends on: `db/*`, `@supabase/supabase-js`
- Used by: every API route
- Purpose: Supabase client + typed query helpers
- Location: `backend/src/db/`
- Contains: `client.ts` (`createSupabaseClient`), `queries/*` (one file per resource: `projects.ts`, `users.ts`, `api-keys.ts`, `insights.ts`, `conversations.ts`, `entries.ts`, `share-links.ts`, `subscriptions.ts`, `activity.ts`, `preferences.ts`, `deleted-accounts.ts`), `types.ts` (row shapes), `query-helpers.ts`, `search-helpers.ts`, `activity-logger.ts`
- Depends on: `@supabase/supabase-js`, `lib/env.ts`
- Used by: every API route via `c.get("db")`
- Purpose: Streamable HTTP MCP server mounted at `/mcp`
- Location: `backend/src/mcp/`
- Contains: `agent.ts` (`SynapseAgent` extends `McpAgent`), `tools/*` (one file per tool family: `context-capture.ts`, `context-retrieval.ts`, `conversations.ts`, `insights.ts`, `project-management.ts`, `google-sync.ts`), `prompts.ts`, `resources.ts`, `mcp-context.ts`
- Depends on: `@modelcontextprotocol/sdk`, `agents`, `db/*`, `lib/auth.ts`
- Used by: `backend/src/index.ts` via `app.mount("/mcp", SynapseAgent.serve("/mcp").fetch)`
- Purpose: Stateful or scheduled work
- Location: see directory names
- Contains: `durable-objects/compaction-scheduler.ts` (idle-delay alarm), `cron/aggregate.ts` (daily aggregation), `sync/from-google.ts`, `sync/to-google.ts`, `sync/google-auth.ts`
- Depends on: `db/*`, `lib/llm/*`
- Used by: `default.scheduled` in `backend/src/index.ts` for crons, route handlers for DO scheduling
- Purpose: SvelteKit pages, server loaders, layouts
- Location: `frontend/src/routes/`
- Contains: route groups `(app)` (authenticated) and `(public)`, plus unauthenticated routes (`login/`, `signup/`, `forgot-password/`, `reset-password/`, `cli-auth/`, `share/[token]/`, `auth/callback/`, `logout/`)
- Depends on: `lib/server/api.ts`, `lib/server/auth.ts`
- Used by: SvelteKit's filesystem-based router
- Purpose: Server-only helpers + shared Svelte components
- Location: `frontend/src/lib/`
- Contains: `server/api.ts` (typed fetch wrapper), `server/auth.ts` (Supabase SSR), `components/` (Svelte 5 components organized by feature: `account/`, `activity/`, `conversations/`, `landing/`, `layout/`, `sharing/`), `types.ts` (frontend-specific types extending `@synapse/shared`)
- Depends on: `@synapse/shared`, `@supabase/ssr`
- Used by: route loaders and components
## Data Flow
### Primary Request Path — v1.1 Handoff Loop
### Slash Command Flow
### LLM Next-Step Inference
- Truth lives in `~/.synapse/projects/<project_id>/events.jsonl` (local, append-only) and `handoff_events` table (cloud, upserted).
- `ProjectStatus` is a *derived* projection — never written by hand. Always rebuilt by `reduce()`.
- Watermark: `~/.synapse/projects/<id>/.watermark` stores the last successfully flushed `event_id` (ULID; lex-comparable to event_id strings).
## Key Abstractions
- Purpose: The atomic unit of state change. Immutable. Idempotent by `event_id`.
- Shape: `{ event_id, project_id, session_id, actor, attached_to, kind, occurred_at, received_at, payload }`
- `actor`: `{ user_id, kind: "human"|"synapse-daemon", device_id, hostname, client }`
- `attached_to`: `Reference | null` — pointer to session/issue/file/commit
- `kind`: from `EventKind` enum — 16 named kinds (see `packages/shared/src/handoff/events.ts`)
- `payload`: open-shape JSON; each handler interprets its own keys
- `SessionOpened`, `SessionClosed`, `ToolUsed`, `FileTouched`, `CommitMade`, `BranchSwitched`, `UserPrompted`, `ContextCompacted`, `SubtaskAdded`, `SubtaskCompleted`, `IssueCreated`, `IssueStateChanged`, `IssueNoted`, `FocusSet`, `NextStepSet`, `NextStepInferred`
- Purpose: The materialised brief view. Single row per project.
- Shape: `{ project_id, current_next_step, active_actors[], recent_activity[50], open_issues: { decisions[], questions[] }, open_subtasks[], updated_at }`
- Always derived by `reduce()`; never assembled imperatively.
- Resolved by `resolveActor(user_id, kind?)` in `mcp/src/capture/actor.ts:17`
- `device_id` is a random 16-hex stored once in `~/.synapse/device_id`
- `hostname` from `os.hostname()`
- `client` currently hard-coded to `"claude-code"`
- `{ type: "session"|"issue"|"file"|"commit", id }`
- Parsed by `parseRef("issue:iss_abc123")` in `mcp/src/cli/handoff-commands.ts:58`
- Single source of truth for `synapse <cmd>` → handler. The CLI entry in `mcp/src/index.ts:159` does `HANDLERS[cmd](args.slice(1))`.
- Subcommands: `brief`, `help`, `stats`, `tree`, `status`, `doctor`, `refresh`, `upgrade`, `whoami`, `capture`, `hook`, `reset`, `uninstall`, `init`, `daemon`, `handoff`, `set-focus`, `note`, `invite`, `issue`, `wizard` (the last is registered at runtime from `index.ts`).
- Cloudflare Durable Object exposing Streamable HTTP MCP transport at `/mcp`.
- Authenticates from `Authorization: Bearer <api-key>` on init via `findUserByApiKeyHash`.
- Registers tools: project-management, context-capture, context-retrieval, insights, conversations, google-sync.
## Entry Points
- Location: compiled to `mcp/dist/index.js`, exposed as bin `synapsesync-mcp` (see `mcp/package.json:6`).
- Triggers: user types `synapse <cmd>` (the slash commands and OS service unit alias the bin to `synapse`); editors auto-launch with no args + non-TTY stdin → MCP server mode.
- Responsibilities: argv parsing, help/version, interactive menu, MCP-stdio mode (`McpServer` + `StdioServerTransport`).
- Location: invoked via `synapse hook <kind>` from `~/.claude/settings.json` (installed by `synapse init`).
- Triggers: every Claude Code SessionStart/UserPromptSubmit/PostToolUse/PreCompact/SessionEnd/SubagentStop event.
- Responsibilities: read JSON event from stdin, derive `cwd`/`git_basename`/`project_id`, dispatch to matching hook handler in `mcp/src/hooks/`.
- Location: invoked via `synapse daemon` from the launchd plist or systemd unit installed by `synapse init` (see `mcp/src/capture/os-service.ts:46`).
- Triggers: machine boot / user login (`RunAtLoad`, `KeepAlive`).
- Responsibilities: read `~/.synapse/config.json`, list tracked projects under `~/.synapse/projects/`, call `startHandoffLoop`, install SIGTERM/SIGINT handlers, block forever.
- Location: deployed to Cloudflare Workers at `api.synapsesync.app` (see `backend/wrangler.jsonc:29`).
- Triggers: HTTP requests + scheduled crons (`*/5 * * * *` Google sync, `0 3 * * *` daily aggregation).
- Responsibilities: route HTTP via Hono, run cron handlers, expose Durable Objects (`SynapseAgent`, `CompactionScheduler`).
- Location: deployed to Cloudflare Pages.
- Triggers: any HTTP request to the dashboard domain.
- Responsibilities: SSR shell, navigation progress, mount route groups.
- Auth gate: `frontend/src/routes/(app)/+layout.server.ts` redirects to `/login` when `locals.user` is unset.
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
### Calling the backend from hook handlers
### Reading `events.jsonl` for status
### Hard-coding `project_id` in CLI handlers
### Adding non-handoff queries to events-batch
### Using Node crypto in the backend
## Error Handling
- Backend: `throw new NotFoundError("project missing")` → caught by `app.onError` in `backend/src/index.ts:51`, which serialises to `{ error, code }` with the `AppError.status`.
- Hooks: `mcp/src/cli/commands.ts:182` wraps every dispatch in try/catch and exits 0 even on failure — the line in the rationale: "Hooks must never break Claude Code".
- Flush cycle: `runFlushCycle` throws on non-2xx; the daemon's `cycle()` catches per-project and continues (`mcp/src/capture/daemon.ts:149`).
- LLM inference: catches any error and falls back to heuristic, logs `[handoff] LLM inference failed, falling back to heuristic` (`mcp/src/capture/daemon.ts:107`).
## Cross-Cutting Concerns
- Backend: `console.error` for errors; the request error includes `c.req.method`, `c.req.path`, error message, and stack (`backend/src/index.ts:55`).
- Daemon: `console.error` + appends to `~/.synapse/capture.log` for the capture worker (`mcp/src/capture/capture-worker.ts:18`).
- CLI: `@clack/prompts` for user-facing messages, `process.stderr.write` for diagnostics.
- Backend: Zod schemas centralised in `backend/src/lib/validate.ts` (`schemas.createProject`, `schemas.addMember`, `schemas.createInsight`, `schemas.resolveProject`), used via `parseBody(c, schemas.x)`.
- CLI handoff args: hand-rolled parsers in `mcp/src/cli/handoff-arg-parse.ts` that throw `Error("usage: ...")`.
- Backend: bearer token in `Authorization` header, JWT (Supabase) or API-key. `authMiddleware` (`backend/src/lib/auth.ts:31`) is applied per sub-app via `app.use("*", authMiddleware)`.
- API-key hashing: `hashApiKey(key)` returns lowercase hex SHA-256 (`backend/src/lib/auth.ts:17`).
- Frontend: Supabase SSR cookies via `@supabase/ssr`; `lib/server/auth.ts` constructs the client; `locals.user`/`locals.token` populated in hooks (the `+layout.server.ts` files redirect to `/login` when unset).
- MCP CLI: api-key in `~/.synapse/config.json` (`mcp/src/cli/invite.ts:22`).
- HTTP: `Idempotency-Key` header allowed in CORS; `idempotency` middleware in `backend/src/lib/idempotency.ts` applied to `/api/projects/*` and `/api/insights/*` and others.
- Events: `event_id` ULIDs + `upsert(..., { onConflict: "event_id", ignoreDuplicates: true })`.
- `rateLimit(120, 60000)` mounted globally in `backend/src/index.ts:46` — 120 requests/minute keyed by IP or API key.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
