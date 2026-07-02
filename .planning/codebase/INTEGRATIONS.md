# External Integrations

**Analysis Date:** 2026-05-15

## APIs & External Services

**LLM / Inference:**
- **Anthropic API** — direct REST calls from the Worker for server-side conversation compaction and project-context aggregation.
  - SDK/Client: hand-rolled `fetch` wrapper at `https://api.anthropic.com/v1/messages` with `x-api-key` header and `anthropic-version: 2023-06-01` — see `backend/src/lib/llm/anthropic.ts:10-32`.
  - Auth: `COMPACTION_LLM_KEY` (set via `wrangler secret put`, env interface in `backend/src/lib/env.ts:46`).
  - Default model: `claude-haiku-4-5-20251001` — pinned in `backend/wrangler.jsonc:40`, also default in `backend/src/lib/llm/compact.ts:12` and `backend/src/durable-objects/compaction-scheduler.ts:56`. Cron aggregation uses the same default (`backend/src/cron/aggregate.ts:14`).
  - Invoked by: `CompactionScheduler` Durable Object alarm (`backend/src/durable-objects/compaction-scheduler.ts`) — 5-minute idle delay, gated on Plus tier — and the daily cron (`backend/src/cron/aggregate.ts:1-40`).
  - **Plus tier only**: compaction is skipped for `free` users (`backend/src/durable-objects/compaction-scheduler.ts:41-42`).

- **Anthropic Claude Code subprocess** — the capture daemon optionally spawns `claude` as a subprocess to infer next-step text from recent events. Uses the user's local Claude Code subscription (no Anthropic API key needed from Synapse).
  - Implementation: `mcp/src/capture/daemon-cc.ts:1-48`.
  - Invocation: `spawnFn("claude", ["-p", prompt, "--config", profile, "--max-turns", "1"])` with `SYNAPSE_DAEMON_SESSION=1` env to prevent recursion.
  - Profile pinned: `~/.synapse/daemon-cc-profile.json` denies write tools (`Edit`, `Write`, `MultiEdit`, `Bash`, `NotebookEdit`, `Agent`, `WebFetch`), allows only `Read`, and pins model to `claude-haiku-4-5-20251001` (`mcp/src/capture/daemon-cc.ts:9-17`).
  - **Opt-in** — controlled by `daemon.ai_enabled` in `~/.synapse/config.json`. Heuristic fallback in `mcp/src/capture/heuristic-synth.ts` when disabled.

- **Embedding service (nomic-embed-text-v1.5)** — internal HTTP sidecar producing 768-dim vectors.
  - Client: `backend/src/lib/embeddings.ts:18-53` — `POST {url}/embed`, `Authorization: Bearer ${EMBEDDING_SERVICE_KEY}`, body `{ texts, type: "search_query" | "search_document" }`, 3s timeout (`EMBEDDING_TIMEOUT_MS` in `backend/src/lib/constants.ts:50`).
  - Implementation: `embedding-service/app.py` (FastAPI). Model preloaded at startup via lifespan (`embedding-service/app.py:23-26`), normalised embeddings returned.
  - Config: `EMBEDDING_SERVICE_URL` + `EMBEDDING_SERVICE_KEY` Worker secrets — both optional; semantic search degrades silently when unset (`backend/src/lib/embeddings.ts:24`).

**Source Control / File Sync:**
- **Google Drive** — bi-directional sync for project entries.
  - SDK: hand-rolled `fetch` against `https://www.googleapis.com/drive/v3/files` (`backend/src/sync/from-google.ts:28-41`) and `https://oauth2.googleapis.com/token` for token refresh (`backend/src/sync/google-auth.ts:9`).
  - OAuth scope: `https://www.googleapis.com/auth/drive.file` (`backend/src/lib/constants.ts:56`).
  - Auth: per-user `google_oauth_tokens` JSONB column on `users` (`supabase/migrations/001_initial_schema.sql:8`), refreshed by `getAccessToken` (`backend/src/sync/google-auth.ts:4`).
  - Endpoints: `POST /api/sync/:project/to-google`, `POST /api/sync/:project/from-google` (`backend/src/api/sync.ts:11-31`).
  - Scheduled drift sync via cron `*/5 * * * *` → `runScheduledGoogleSync` (`backend/src/index.ts:102`).

**Billing:**
- **Creem** — merchant of record, replaced Stripe pre-launch (see `docs/retrospectives/deployment-payments-retrospective.md:64-71`).
  - Client: `backend/src/lib/creem.ts:7-42`. Base URL: `https://api.creem.io/v1` (production) or `https://test-api.creem.io/v1` (when `CREEM_API_KEY` starts with `creem_test_`). Auth header: `x-api-key`.
  - Webhook signing: HMAC-SHA256 via `verifyCreemWebhook` (`backend/src/lib/creem.ts:44-54`). Signature header: `creem-signature`.
  - Endpoints used: `POST /checkouts`, `GET /checkouts?checkout_id=...`, `POST /customers/billing`, `POST /subscriptions/:id/cancel`.
  - Webhook handler: `POST /api/billing/webhook` — handles `checkout.completed`, `subscription.{active,paid,scheduled_cancel,canceled,expired,past_due}` (`backend/src/api/billing.ts:17-118`). The webhook route is registered **before** auth middleware (`backend/src/api/billing.ts:121`).
  - Fallback verification: `POST /api/billing/verify` queries Creem directly when webhook hasn't fired yet (`backend/src/api/billing.ts:154-201`).
  - Worker env: `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRO_PRODUCT_ID` (`backend/src/lib/env.ts:31-33`).
  - **Stripe** is NOT integrated. References in `backend/test/db/queries.test.ts:622-632` are legacy test fixtures verifying the provider-agnostic `subscriptions` table; the only real production billing path is Creem.

## Data Storage

**Primary Database — Supabase Postgres:**
- Connection: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (server) or `SUPABASE_ANON_KEY` (frontend).
- Server client: `backend/src/db/client.ts:1-8` — `createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })`. Service key bypasses RLS by design; route handlers do their own membership checks.
- Frontend client: `frontend/src/lib/server/auth.ts:1-22` — `@supabase/ssr` `createServerClient` using anon key with cookie-based session.
- 19 migrations under `supabase/migrations/`:
  - `001_initial_schema.sql` — users, projects, project_members, entries (+ entry_history), user_preferences. RLS enabled on all (`001_initial_schema.sql:79-86`).
  - `005_pgvector.sql` — `CREATE EXTENSION vector`, adds `embedding vector(768)` to entries, HNSW cosine index, `match_entries` RPC for semantic search.
  - `006_insights.sql` — agent-captured insights (decision/learning/preference/architecture/action_item).
  - `007_conversations.sql` — canonical conversation + message tables for capture pipeline.
  - `012_compaction.sql` — `compacted_summary`, `project_context` tables for LLM compaction.
  - `013_deleted_accounts.sql` — audit trail for deleted users (`recordDeletedAccount` in `backend/src/api/admin.ts`).
  - `015_handoff_layer.sql` — `handoff_sessions`, `handoff_events`, `handoff_issues`, `handoff_project_status` (the v1 handoff tables).
  - `016_drop_handoff_session_fks.sql` — relax constraints to allow event-only flushes.
  - `017_project_invites.sql` — new v1.1 invite tokens table backing `synapse invite <email>`.
- RLS: enabled on `users`, `projects`, `project_members`, `entries`, `entry_history`, `user_preferences`, `share_links` (`001_initial_schema.sql:79-84`, `002_frontend_support.sql:20`). The Worker uses the service role key (`backend/src/db/client.ts:5`) so RLS is treated as defense-in-depth, not the primary authorization boundary — see comment at `001_initial_schema.sql:86-88`.

**File Storage:**
- Supabase Storage — single bucket `conversation-media` for inline media attachments on captured conversations.
- Wrapper: `backend/src/lib/storage.ts:4-25`. Signed URL TTL: 1 hour (`SIGNED_URL_EXPIRY_SECONDS` in `backend/src/lib/constants.ts:47`).
- Path convention: `conversations/{conversation_id}/{message_id}/{filename}` (`backend/src/lib/storage.ts:12`).

**Local filesystem (capture daemon):**
- `~/.synapse/` — daemon root. Override via `SYNAPSE_HOME` env (`mcp/src/capture/handoff-paths.ts:5`).
- `~/.synapse/config.json` — API key + user preferences (`mcp/src/cli/init.ts:126-132`).
- `~/.synapse/projects/<project_id>/events.jsonl` — append-only event log per project.
- `~/.synapse/projects/<project_id>/cache/{brief.md,project_status.json}` — last-known brief and ProjectStatus from backend.
- `~/.synapse/projects/<project_id>/.watermark` — last-flushed event_id (`mcp/src/capture/handoff-sync.ts:32`).
- `~/.synapse/capture.pid` / `~/.synapse/capture.log` — daemon PID + stdout/stderr (`mcp/src/capture/daemon.ts:25-26`).
- `~/.synapse/daemon-cc-profile.json` — pinned profile for daemon-spawned Claude Code subprocesses (`mcp/src/capture/daemon-cc.ts:7`).
- `~/.synapse/daemon-flush-now` / `~/.synapse/daemon.healthcheck` — file-based signalling between CLI and daemon (`mcp/src/capture/handoff-paths.ts:28-30`).

**Durable Object storage (Workers):**
- `SynapseAgent` — backs the Streamable HTTP MCP transport, holds per-session state. Sqlite-backed (`backend/wrangler.jsonc:20-23`).
- `CompactionScheduler` — alarm-driven LLM compaction scheduler (`backend/src/durable-objects/compaction-scheduler.ts`). 5-minute idle delay before firing. Sqlite-backed (`backend/wrangler.jsonc:24-27`).

**In-memory caches:**
- Rate-limit window — `Map` in `backend/src/lib/rate-limit.ts:6` (per-isolate, not durable).
- Idempotency cache — `Map` in `backend/src/lib/idempotency.ts:6`, 24h TTL (per-isolate).
- These are intentionally per-isolate; the 120-req/min rate limit is best-effort.

## Authentication & Identity

**Auth Provider:**
- **Supabase Auth** — primary user identity (email/password + OAuth).
  - JWT verification (frontend session tokens): `backend/src/lib/auth.ts:42-60` calls `supabase.auth.getUser(token)` and joins to `public.users` via `supabase_auth_id`.
  - Database trigger keeps `auth.users` and `public.users` in sync robustly — `supabase/migrations/014_robust_auth_user_trigger.sql:1-23` handles email/auth_id conflicts and swallows trigger errors so signups never block.
- **API keys** (server-issued) — for MCP, daemon, scripts.
  - Format: two concatenated UUIDs joined by `-` (e.g. `<uuid>-<uuid>`) — `backend/src/api/auth.ts:142` and other call sites.
  - Storage: SHA-256 hashed in `api_keys` table (`backend/src/api/auth.ts:64-67`).
  - Multi-key per user, capped at `API_KEY_MAX_PER_USER = 10` (`backend/src/lib/constants.ts:39`).
  - Endpoints: `POST /auth/cli-exchange` (PKCE exchange), `GET /api/account/api-keys` list, `POST /api/account/api-keys` create, `DELETE` revoke.

**Auth middleware:** `backend/src/lib/auth.ts:31-94`
- Reads `Authorization: Bearer <token>` header.
- Tries JWT path first (3-segment dotted check), falls back to API-key path.
- Sets `c.var.user` (UserRow) and `c.var.tier` (`"free"` | `"plus"` derived from active subscription).
- Mounted on all `/api/*` and `/auth/*` routes (`backend/src/index.ts:48-49`).

**CLI auth flow (browser-based PKCE):**
- `mcp/src/cli/browser-auth.ts:11-17` — generate verifier + SHA256 challenge.
- `mcp/src/cli/api.ts:35-46` → `POST /auth/cli-exchange { code, code_verifier }` returns `{ api_key, email }`.
- Server-side: stateless encrypted session tokens using HKDF-derived AES-GCM key with salt `synapse-cli-session` (`backend/src/api/auth.ts:36-77`). 5-min TTL (`CLI_SESSION_TTL_MS` in `backend/src/lib/constants.ts:37`).
- SSH/CI fallback: `synapse login --email --password` prints JSON (`mcp/src/cli/browser-auth.ts:19-30` detects non-TTY).

**Admin auth:** Custom `X-Admin-Secret` header checked against `ADMIN_SECRET` env (`backend/src/api/admin.ts:14-21`). Used only by `/api/admin/*`.

**Deprecated / removed:**
- `SYNAPSE_PASSPHRASE` client-side encryption — **removed in v1.1**. No live references in `backend/src/` or `mcp/src/`; only historical mentions in `docs/superpowers/plans/2026-05-14-handoff-layer-v1.1.md:1285-1301`.

## Monitoring & Observability

**Error Tracking:**
- Cloudflare Workers Observability enabled in `backend/wrangler.jsonc:41-47` — full invocation logs, 100% head-sampling.
- No Sentry/Bugsnag/DataDog integrations.
- Global error handler in `backend/src/index.ts:51-65` — `AppError` instances map to status codes, anything else is logged with `console.error(...)` and returned as 500 with detail.

**Logs:**
- `console.log`/`console.error` throughout; namespaced prefixes like `[creem]`, `[billing]`, `[auth]`, `[embeddings]`, `[compaction]`, `[aggregate]`, `[api]` make tail-grep usable.
- MCP daemon: `~/.synapse/capture.log` and `~/.synapse/daemon.log` (paths in `mcp/src/capture/daemon.ts:26`, `mcp/src/capture/os-service.ts:50`).
- Frontend server-side logging: `frontend/src/lib/server/api.ts:29` logs every API request.
- Activity log table (`activity_log`) records member changes, capture events, etc. via `backend/src/db/activity-logger.ts`.

## CI/CD & Deployment

**Hosting:**
- Worker: Cloudflare Workers, custom domain `api.synapsesync.app` (`backend/wrangler.jsonc:29`).
- Frontend: Cloudflare Pages — `synapsesync.app` (apex) and `synapse-7mq.pages.dev` (preview alias). Both whitelisted in CORS at `backend/src/index.ts:35`.
- MCP CLI: npm package `synapsesync-mcp` (`mcp/package.json:2`).
- Embedding service: Docker container (any host); reference Dockerfile in `embedding-service/Dockerfile`.

**CI Pipeline:**
- GitHub Actions: `.github/workflows/ci.yml`
  - `verify` job (every PR + push to `main`): Node 22, `npm install`, copy `frontend/.env.example` → `frontend/.env`, `npm run lint`, `typecheck`, `test`.
  - `e2e` job (only on `main` push, requires `prod` environment): builds MCP, runs `vitest run test/e2e/` against secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_KEY`, `TEST_API_URL`.
- npm publish: `.github/workflows/publish.yml` — triggers on `mcp-v*` tags or manual dispatch. Uses npm trusted publishing (`--provenance`, `id-token: write`).

**Deploy:**
- Worker: `wrangler deploy` from `backend/` (`backend/package.json:10`).
- Migrations: `supabase db push` via `backend/npm run db:migrate` (`backend/package.json:11`).
- Frontend: Cloudflare Pages build (likely Git-driven; no in-repo Pages workflow).

## Environment Configuration

**Required Worker env (set via `wrangler secret put`):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — required (Worker won't start auth flows).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — required for Google Drive sync paths.
- `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRO_PRODUCT_ID` — required for billing.
- `COMPACTION_LLM_KEY` — required for the `CompactionScheduler` Durable Object and daily aggregation cron; skipped gracefully when missing (`backend/src/durable-objects/compaction-scheduler.ts:51-54`, `backend/src/cron/aggregate.ts:8-12`).
- `ADMIN_SECRET` — required only for `/api/admin/*`.

**Optional Worker env:**
- `EMBEDDING_SERVICE_URL`, `EMBEDDING_SERVICE_KEY` — semantic search degrades to text-only without these (`backend/src/lib/embeddings.ts:24`).
- `CORS_ORIGINS` — comma-separated allowlist override (default in `backend/src/index.ts:35`).
- `APP_URL` — defaults to `https://synapsesync.app`.
- `TIER_*` and `VALID_SOURCES` — see `backend/src/lib/env.ts:22-37`.

**Required frontend env (`frontend/.env`):**
- `API_URL` — Worker base URL.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — Supabase project for SSR auth.

**Required MCP env (set by `synapse init`):**
- `SYNAPSE_API_KEY` — read from env first, then `.mcp.json` in cwd, then `~/.mcp.json` (`mcp/src/capture/cloud-sync.ts:19-44`). The MCP server refuses to start without it (`mcp/src/index.ts:237-242`).

**Secrets locations:**
- Worker secrets: Cloudflare Wrangler (`wrangler secret put` — managed remotely, never committed).
- Local dev: `backend/.dev.vars` (Worker), `frontend/.env` (frontend), `~/.synapse/config.json` (MCP). All gitignored.
- Example templates: `.dev.vars.example` (repo root), `frontend/.env.example` (committed).

## Webhooks & Callbacks

**Incoming:**
- `POST /api/billing/webhook` — Creem subscription lifecycle (`backend/src/api/billing.ts:17`). Verified via `creem-signature` HMAC-SHA256 header. Mounted **before** auth middleware so it doesn't require a Bearer token.
- Google OAuth callback — handled via SvelteKit `/auth/*` route at `frontend/src/routes/auth/`; tokens stored in `users.google_oauth_tokens` JSONB.
- Supabase Auth callbacks — handled in frontend routes (`frontend/src/routes/auth/`); session managed via cookies + `@supabase/ssr`.

**Outgoing:**
- Anthropic API (`https://api.anthropic.com/v1/messages`) — compaction calls (`backend/src/lib/llm/anthropic.ts:10`).
- Google Drive API (`https://www.googleapis.com/drive/v3/files`) — file list + download (`backend/src/sync/from-google.ts:28-39`).
- Google OAuth token refresh (`https://oauth2.googleapis.com/token`) — `backend/src/sync/google-auth.ts:9`.
- Creem API (`https://api.creem.io/v1` / `https://test-api.creem.io/v1`) — `backend/src/lib/creem.ts:3-19`.
- Embedding service (`${EMBEDDING_SERVICE_URL}/embed`) — `backend/src/lib/embeddings.ts:30`.
- MCP CLI → Worker: every `synapse <cmd>` and the capture daemon flushes to `https://api.synapsesync.app` (constant in `mcp/src/cli/config.ts:1`).

## MCP & Slash-Command Surface (Claude Code)

**MCP — Streamable HTTP (current, production):**
- Mounted at `/mcp` on the Worker via `app.mount("/mcp", SynapseAgent.serve("/mcp").fetch)` (`backend/src/index.ts:90`).
- Implementation: `backend/src/mcp/agent.ts:27-66` extends `McpAgent` from `agents/mcp` (Cloudflare-published). Auth via `Authorization: Bearer <api-key>` extracted from the original request in `init()` (`backend/src/mcp/agent.ts:42-52`).
- Tool registrations live in `backend/src/mcp/tools/` — `project-management.ts`, `context-capture.ts`, `context-retrieval.ts`, `insights.ts`, `conversations.ts`, `google-sync.ts`.
- Prompts + Resources: `backend/src/mcp/prompts.ts`, `backend/src/mcp/resources.ts` (e.g. `context://{project}/tree` resource template).

**MCP — Stdio transport (DEPRECATED — legacy, removal target v2.0):**
- Implementation: `mcp/src/index.ts:262-399`. Comment at `mcp/src/index.ts:267-269` documents the deprecation and removal target.
- Only **two** tools remain in the legacy stdio surface: `save_insight` (`mcp/src/index.ts:302-337`) and `list_insights` (`mcp/src/index.ts:340-389`).
- All other tools (`ls`, `read`, `search`, `history`, `tree`, `list_conversations`, `load_conversation`) were **removed in v1.1**. Confirmed in README (`README.md:73-75`) and ARCHITECTURE doc (`docs/ARCHITECTURE.md:12`).
- Activated only when `process.argv.length === 0 && !isInteractiveTerminal()` (`mcp/src/index.ts:124-126,226-400`) — i.e. when launched by an MCP host like Cursor/Windsurf.
- Hosts other than Claude Code still use this; Claude Code uses the slash commands + hooks instead.

**Slash commands (current — installed by `synapse init`):**
- Six commands written into `~/.claude/commands/synapse/` (`mcp/src/cli/init.ts:90-97`):
  - `/synapse:handoff "<arg>"` → `synapse handoff "$ARGUMENTS"` (`mcp/src/cli/init.ts:41-47`).
  - `/synapse:focus "<arg>"` → `synapse set-focus "$ARGUMENTS"` (`mcp/src/cli/init.ts:48-54`).
  - `/synapse:issue create|resolve|supersede ...` → parses then runs `synapse issue ...` (`mcp/src/cli/init.ts:55-66`).
  - `/synapse:status` → `synapse status` (`mcp/src/cli/init.ts:67-73`).
  - `/synapse:doctor` → `synapse doctor` (`mcp/src/cli/init.ts:74-80`).
  - `/synapse:invite "<email>"` → `synapse invite "$ARGUMENTS"` (`mcp/src/cli/init.ts:81-87`).
- Slash command files are **idempotent**: `synapse init` skips files that already exist (`mcp/src/cli/init.ts:95`).

**Claude Code hooks (installed by `synapse init`):**
- Six hook entries injected into `~/.claude/settings.json` (`mcp/src/cli/init.ts:103-119`):
  - `SessionStart` → `synapse hook session-start` (emits `<synapse-brief>...</synapse-brief>` from cache — `mcp/src/hooks/session-start.ts:27`).
  - `UserPromptSubmit` → `synapse hook user-prompt-submit`.
  - `PostToolUse` → `synapse hook post-tool-use` with matcher `Bash|Edit|Write|MultiEdit|TaskCreate|TaskUpdate|Agent` (`mcp/src/cli/init.ts:22-24`).
  - `PreCompact` → `synapse hook pre-compact`.
  - `SessionEnd` → `synapse hook session-end`.
  - `SubagentStop` → `synapse hook subagent-stop`.
- Hook dispatcher: `mcp/src/cli/hook-dispatch.ts` reads JSON payload from stdin, routes to the appropriate `mcp/src/hooks/<kind>.ts` handler.
- Each hook handler appends a typed event to `~/.synapse/projects/<project_id>/events.jsonl` using `EventKind` enum from `@synapse/shared/handoff/events.js` (15 kinds: `SessionOpened`, `ToolUsed`, `FileTouched`, `CommitMade`, `IssueCreated`, `FocusSet`, `NextStepSet`, etc. — see `packages/shared/src/handoff/events.ts:1-20`).
- `synapse init` is **idempotent** for hooks (`mcp/src/cli/init.ts:112-117`) — re-running doesn't duplicate entries.

**DEPRECATED `capture hook-install` — removed in v1.1:**
- The `hook-install` / `hook-uninstall` subcommands and `mcp/src/capture/hooks.ts` were retired. `synapse init` is now the canonical install path. See plan reference: `docs/superpowers/plans/2026-05-14-handoff-layer-v1.1.md:1204-1233`.

**Handoff event flow (the v1.1 layer):**
1. Claude Code event fires → `synapse hook <kind>` runs.
2. Hook appends to `~/.synapse/projects/<id>/events.jsonl` and signals daemon via `~/.synapse/daemon-flush-now` flag file (`mcp/src/capture/handoff-paths.ts:28`).
3. Capture daemon (`mcp/src/capture/daemon.ts` — launchd or systemd) batches events and `POST /api/events/batch` to the Worker (`mcp/src/capture/handoff-sync.ts:37-42`).
4. Worker reducer (`backend/src/lib/handoff-reducer.ts`) folds events into `handoff_project_status.status` (JSONB column).
5. Daemon pulls latest `ProjectStatus` (`GET /api/projects/:id/status` — `backend/src/api/project-status.ts:8`) and refreshes `~/.synapse/projects/<id>/cache/brief.md`.
6. Next `SessionStart` reads `brief.md` and emits `<synapse-brief>...</synapse-brief>` to stdout (`mcp/src/hooks/session-start.ts:20-27`).
7. Backend auto-creates a canonical `projects` row when it sees a `cwd_<hash>` placeholder; remap returned in `canonical_project_ids` (`mcp/src/capture/handoff-sync.ts:44-57`), and the daemon renames the local project dir on disk.

## REST API Surface (Worker)

Mounted under `https://api.synapsesync.app` — routes registered in `backend/src/index.ts:67-87`:
- `GET /health` — public liveness probe.
- `/auth/*` — public auth endpoints (signup, login, cli-exchange).
- `/api/context/*` — entry CRUD (`backend/src/api/context.ts`).
- `/api/events/batch` — handoff event flush from daemon (`backend/src/api/events-batch.ts`).
- `/api/projects/*` — projects CRUD, project resolution by name/cwd, `:id/status`, `:id/events`.
- `/api/sync/:project/{to,from}-google` — Drive sync.
- `/api/share/:token/{join}` — share-link redemption (`backend/src/api/share.ts:12`).
- `/api/account/*` — current user, API keys, delete account.
- `/api/admin/*` — admin tools (gated by `X-Admin-Secret`).
- `/api/billing/{checkout,verify,portal,status,webhook}` — Creem flows.
- `/api/insights` — agent-captured insights (consumed by the legacy MCP `save_insight` / `list_insights`).
- `/api/invites` and `/api/projects/:id/invites` — v1.1 invite tokens (`backend/src/api/invites.ts`).
- `/api/conversations/*` — canonical conversation read/write for capture pipeline.
- `/api/compaction` — kicks the `CompactionScheduler` Durable Object alarm manually.
- `/mcp` — Streamable HTTP MCP transport (Durable Object).

CORS allowed origins (default): `http://localhost:5173`, `https://synapsesync.app`, `https://synapse-7mq.pages.dev` (`backend/src/index.ts:33-36`). Override with `CORS_ORIGINS` env.

Rate limit: 120 req/min keyed by `Authorization` header or `cf-connecting-ip` (`backend/src/lib/rate-limit.ts:10`). Per-isolate, in-memory.

---

*Integration audit: 2026-05-15*
