# Technology Stack

**Analysis Date:** 2026-05-15

## Languages

**Primary:**
- TypeScript 5.9.3 — backend (`backend/`), MCP package (`mcp/`), shared types (`packages/shared/`)
- TypeScript 5.0.x — frontend (`frontend/`, baseline pinned in `frontend/package.json`)
- Svelte 5.54.0 — frontend UI (`frontend/src/routes/`, `frontend/src/lib/components/`)
- SQL (Postgres) — Supabase migrations (`supabase/migrations/`)

**Secondary:**
- Python 3.12 — optional embedding sidecar (`embedding-service/app.py`, `embedding-service/Dockerfile`)
- Plist XML / systemd unit text — emitted by `mcp/src/capture/os-service.ts` for launchd / systemd registration; no XML runtime dependency.

## Runtime

**Backend runtime — Cloudflare Workers:**
- Compatibility date: `2025-04-01` (`backend/wrangler.jsonc:5`)
- Compatibility flags: `nodejs_compat` (`backend/wrangler.jsonc:6`)
- Durable Object classes: `SynapseAgent` (MCP server), `CompactionScheduler` (alarm-driven LLM summarisation) — `backend/wrangler.jsonc:7-28`
- Cron triggers: `*/5 * * * *` (Google sync), `0 3 * * *` (daily aggregation) — `backend/wrangler.jsonc:30-32`
- Custom domain route: `api.synapsesync.app` (`backend/wrangler.jsonc:29`)

**MCP package + capture daemon:**
- Node.js (ESM) — `"type": "module"` in `mcp/package.json`
- Minimum Node version: 22 (CI matrix in `.github/workflows/ci.yml:23`, `publish.yml:24`); `@types/node` pinned to `^22.0.0` in `mcp/package.json:39`.
- Distributed as the `synapsesync-mcp` npm package; `bin/synapsesync-mcp` points at `dist/index.js` with a shebang patched in by `mcp/scripts/add-shebang.mjs`.
- Long-running daemon process registered via launchd (`~/Library/LaunchAgents/app.synapsesync.daemon.plist`) on macOS or systemd user service on Linux — see `mcp/src/capture/os-service.ts:46-64`.

**Frontend runtime:**
- SvelteKit 2.55.0 on Vite 6 — see `frontend/package.json:18-26`.
- Adapter: `@sveltejs/adapter-auto` (`frontend/svelte.config.js:1`) — production target is Cloudflare Pages (`https://synapse-7mq.pages.dev`, also `https://synapsesync.app` aliased via CORS allowlist in `backend/src/index.ts:35`).

**Embedding service runtime:**
- Python 3.12 slim Docker image (`embedding-service/Dockerfile:1`).
- FastAPI 0.128.8 + Uvicorn 0.39.0 (`embedding-service/requirements.txt:13-14`).
- Model pre-downloaded at build time: `nomic-ai/nomic-embed-text-v1.5` (`embedding-service/Dockerfile:9`).

**Package Manager:**
- npm with workspaces — `"workspaces": ["packages/*", "backend", "frontend", "mcp"]` (`package.json:4`).
- Lockfile: `package-lock.json` present at repo root.
- CI uses `npm install` on Node 22 (`.github/workflows/ci.yml:25-26`).

## Frameworks

**Core:**
- Hono 4.12.8 — HTTP router for the Worker (`backend/src/index.ts:1`, mounted in `backend/package.json:22`). All routes are `new Hono<{ Bindings: Env }>()`.
- SvelteKit 2.55 — frontend framework (`frontend/package.json:17`).
- Svelte 5.54 (runes mode) — UI components (`frontend/package.json:21`).
- Tailwind CSS 4.2.2 — styling, wired via `@tailwindcss/vite` plugin (`frontend/vite.config.ts:2`).
- MCP SDK — `@modelcontextprotocol/sdk` 1.27.1 in `mcp/`, `^1.26.0` in `backend/` (`mcp/package.json:34`, `backend/package.json:19`).
- Cloudflare `agents` package 0.7.9 — provides `McpAgent` base used by `backend/src/mcp/agent.ts:2`. The Streamable HTTP MCP transport is mounted at `/mcp` via `SynapseAgent.serve("/mcp").fetch` (`backend/src/index.ts:90`).
- Supabase JS 2.99.2 — backend and frontend (`backend/package.json:21`, `frontend/package.json:30`).
- Supabase SSR 0.9.0 — frontend cookie-based session (`frontend/package.json:29`).
- FastAPI 0.128.8 + Pydantic 2.12.5 — embedding sidecar (`embedding-service/requirements.txt:13,15`).

**Testing:**
- Vitest 4.1.x — used in `backend/` (with `@cloudflare/vitest-pool-workers` 0.13.2), `frontend/`, and `mcp/` (`backend/vitest.config.ts`, `frontend/vitest.config.ts`, `mcp/vitest.config.ts`).
- `@cloudflare/vitest-pool-workers` runs backend tests inside a simulated Workers runtime against `wrangler.jsonc` (`backend/vitest.config.ts:1-10`).
- `svelte-check` 4.4.5 — Svelte typechecking (`frontend/package.json:11`).
- MCP test suite organised under `mcp/test/{unit,integration,e2e,capture,hooks,cli,perf}/` (`mcp/vitest.config.ts:7-15`). E2E runs gated by `TEST_E2E=1` in `mcp/package.json:12`.

**Build/Dev:**
- Wrangler 4.75 — Worker dev/deploy, secret management (`backend/package.json:31`). `wrangler dev --test-scheduled` enables cron testing locally (`backend/package.json:6`).
- Vite 6.0 — frontend dev server / build (`frontend/package.json:25`).
- TypeScript 5.9.3 (backend, mcp) / 5.0.x (frontend) — strict mode everywhere.
- Biome 1.9.4 — single repo-wide lint + format tool (`biome.json`, `package.json:18`). Runs across the monorepo via `biome check .`.

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` (1.27.1 mcp / ^1.26 backend) — MCP protocol implementation. Stdio transport in the legacy mcp CLI (`mcp/src/index.ts:5`); Streamable HTTP transport on the backend via `agents/mcp` (`backend/src/mcp/agent.ts:2`).
- `@supabase/supabase-js` 2.99.2 — auth (`backend/src/lib/auth.ts:43`) and database client (`backend/src/db/client.ts`). Server-side uses **service role** key; frontend uses **anon** key via `@supabase/ssr`.
- `hono` 4.12.8 — every Worker route is a `Hono<{ Bindings: Env }>` instance with `cors()`, custom rate-limit, and per-route `dbMiddleware` (`backend/src/index.ts:31-49`).
- `agents` 0.7.9 — Cloudflare-published `McpAgent` base class. Note the inline cast `type AnyMcpAgent = any` in `backend/src/mcp/agent.ts:19` documents a nominal-type mismatch between the agent's bundled SDK copy and the top-level `McpServer` — biome `noExplicitAny` is disabled for this single file (`biome.json:40-48`).
- `zod` — schema validation. **Hard-pinned to 4.3.6** in `mcp/package.json:36`; backend uses `^4.3.6` (`backend/package.json:24`). All MCP tool inputs are zod-validated (`mcp/src/index.ts:6`, `backend/src/lib/validate.ts`).
- `chokidar` ^5 — filesystem watcher for the capture daemon (`mcp/src/capture/watcher.ts:3`). Watches per-tool session logs to materialise `CapturedSession` records.
- `@clack/prompts` ^0.11 — interactive CLI prompts (wizard, capture subcommands) — `mcp/src/index.ts:8`, `mcp/src/cli/wizard.ts:5`.
- `fflate` 0.8.2 — zip in/out for project export/import (`backend/src/lib/export.ts:1`, `backend/src/lib/import.ts:2`).
- `marked` 17.0.5 + `dompurify` 3.3.3 — frontend markdown rendering (`frontend/package.json:33-34`).

**Version pinning quirks:**
- `mcp/package.json` pins **exact** versions for `@modelcontextprotocol/sdk` (1.27.1) and `zod` (4.3.6) — no caret — because the MCP SDK's zod-schema serialisation is sensitive to zod minor versions.
- `backend/package.json` uses `^` ranges for the same packages — they can drift between the published MCP CLI and the deployed Worker; coordinate updates carefully.
- `embedding-service/requirements.txt` hard-pins every Python dep to exact versions (`==`) to keep the Docker layer deterministic and avoid model-incompatible torch/transformers combinations (`embedding-service/requirements.txt:1-15`).

**Infrastructure:**
- `wrangler` ^4.75 — Worker deploy + cron simulation (`backend/package.json:31`).
- `@cloudflare/vitest-pool-workers` ^0.13.2 — runs backend tests inside the Workers runtime against `wrangler.jsonc` (`backend/vitest.config.ts:1-10`).
- `@cloudflare/workers-types/experimental` — typed via `"types"` in `backend/tsconfig.json:7`.

## Configuration

**Environment:**
- Backend env interface: `backend/src/lib/env.ts:1-49` enumerates all bindings: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `CREEM_API_KEY`/`WEBHOOK_SECRET`/`PRO_PRODUCT_ID`, `EMBEDDING_SERVICE_URL/KEY`, `COMPACTION_LLM_KEY/MODEL`, plus tier-limit overrides.
- All secrets set via `wrangler secret put` — `backend/wrangler.jsonc:33-37` explicitly warns against putting them in `vars` (would zero out on deploy).
- Only non-secret var inline: `COMPACTION_LLM_MODEL = "claude-haiku-4-5-20251001"` (`backend/wrangler.jsonc:39`).
- Local dev: copy `.dev.vars.example` → `backend/.dev.vars` (file exists at repo root: `/Users/Tanmai.N/Documents/synapse/.dev.vars.example`).
- Frontend env: `frontend/.env.example` → `frontend/.env` with `API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. The frontend reads these via `$env/dynamic/private` (`frontend/src/lib/server/auth.ts:1`, `frontend/src/lib/server/api.ts:1`).
- MCP user config: `~/.synapse/config.json` written by `synapse init` (`mcp/src/cli/init.ts:121-132`); houses `api_key` and the opt-in `daemon.ai_enabled` flag.
- MCP runtime env: `SYNAPSE_API_KEY` (required for MCP mode — `mcp/src/index.ts:234`), `SYNAPSE_SOURCE` (defaults `claude` — `mcp/src/index.ts:235`), `SYNAPSE_HOME` (overrides `~/.synapse` — `mcp/src/capture/handoff-paths.ts:5`), `SYNAPSE_TEST_PROJECT_ID` (tests).

**Build:**
- Backend: `npm run build` is a no-op for the Worker (Wrangler builds on `deploy`); `typecheck` runs `tsc --noEmit` (`backend/package.json:8-9`).
- MCP: `tsc` emits `dist/`, then `scripts/add-shebang.mjs` prepends `#!/usr/bin/env node` and `chmod 0755` (`mcp/package.json:10`, `mcp/scripts/add-shebang.mjs`).
- Frontend: `vite build` (`frontend/package.json:7`).
- Root: `npm run build` chains lint + workspace builds (`package.json:8`). `npm run verify` chains lint + typecheck + test (`package.json:12`).

**Forbidden — files not read:**
- `frontend/.env` (exists; secrets).
- `backend/.dev.vars` is not present locally; `.dev.vars.example` is committed.

## Platform Requirements

**Development:**
- Node 22.x (CI baseline; matches `@types/node` ^22 in `mcp/`). `@types/node` is `^25.5.0` in `backend/` — CI still uses Node 22, so do not assume Node 25 runtime APIs.
- npm with workspaces (npm 8+).
- For the daemon: macOS (launchd) or Linux (systemd user services). Windows is partially supported by `os-service.ts` (chmod is wrapped in try/catch in `add-shebang.mjs`).
- Supabase CLI (for `supabase db push` via `backend/package.json:11`'s `db:migrate`).
- Optional: Docker for the embedding sidecar.

**Production:**
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

---

*Stack analysis: 2026-05-15*
