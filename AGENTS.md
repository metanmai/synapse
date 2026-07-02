# Synapse — Agent Orientation

Synapse captures AI coding sessions and surfaces cross-session insights. SvelteKit frontend → Cloudflare Workers backend → Supabase Postgres, plus an MCP CLI (`synapsesync-mcp`) that runs locally as a capture daemon.

## Essential Commands

```bash
npm run build          # lint + build all workspaces
npm run test           # vitest run across all workspaces (~747 tests)
npm run lint           # biome check .
npm run lint:fix       # biome check --write .
npm run format         # biome format --write .
npm run typecheck      # tsc --noEmit (backend/mcp) + svelte-check (frontend)
npm run verify         # lint + typecheck + test (pre-push hook, ~25s)
npm run test:e2e       # 5-script E2E chain against live backend (~5-8 min)
npm run dev:backend    # wrangler dev --test-scheduled
npm run dev:frontend   # vite dev

# Per-workspace
cd mcp       && npx vitest run    # 309+171skipped → 485 total
cd backend   && npx vitest run    # 360+12skipped → 372 total
cd frontend  && npx vitest run    # 65 tests
cd packages/shared && npx vitest  # 13 tests
```

**Build note:** `mcp/` requires `tsc && node scripts/add-shebang.mjs` — the shebang script patches `dist/index.js` for CLI use. `backend/` has `"noEmit": true`, Wrangler builds on deploy.

## Architecture at a Glance

```
CLI / Hooks (local)          Backend (CF Workers)        Supabase Postgres
───────────────────         ────────────────────        ─────────────────
synapse hook <kind>  ──▶    POST /api/events/batch ──▶  handoff_events
     │                      (materialize status)         handoff_project_status
     ▼                                                  
events.jsonl ──flush──▶     GET /api/projects/:id/status
     │                                                      
daemon pulls status ──▶     /mcp (Streamable HTTP MCP)     
     │                                                      
brief.md injected into                                   
next SessionStart hook                                  
```

**Core pattern:** Event-sourced, local-first. Hooks append to `events.jsonl` without network I/O. The daemon flushes batches to the backend. A **pure reducer** in `packages/shared/src/handoff/reducer.ts` folds events into `ProjectStatus` — same code on client and server, deterministic given same input.

## Workspace Layout

| Path | Package | Runtime | Key files |
|------|---------|---------|-----------|
| `mcp/` | `synapsesync-mcp` | Node 22 ESM | `src/index.ts` (entry), `src/capture/` (daemon+log+sync), `src/hooks/` (6 Claude Code hook handlers), `src/cli/` (subcommands) |
| `backend/` | `@synapse/backend` | CF Workers (Hono) | `src/index.ts` (router), `src/api/` (Hono sub-apps), `src/db/` (Supabase queries), `src/lib/` (auth, errors, reducer wrapper), `src/mcp/` (Durable Object MCP server) |
| `frontend/` | `@synapse/frontend` | SvelteKit (Vite) | `src/routes/` (pages), `src/lib/server/` (SSR API client), `src/lib/components/` (Svelte 5) |
| `packages/shared/` | `@synapse/shared` | TypeScript only | `src/handoff/reducer.ts` (THE reducer), `src/handoff/types.ts`, `src/handoff/events.ts` |
| `embedding-service/` | — | Python 3.12 Docker | `app.py` (FastAPI, nomic-embed-text-v1.5) |
| `supabase/migrations/` | — | SQL | 19 numbered migrations |

## Import Rules (Critical — Gets Wrong Often)

**`mcp/`**: Node16 ESM — relative imports MUST include `.js` extension:
```ts
import { resolveActor } from "../capture/actor.js";  // .js even though source is .ts
```

**`backend/` and `frontend/`**: bundler resolution — NO extension on relative imports:
```ts
import { authMiddleware } from "../lib/auth";  // no extension
```

**`packages/shared/`**: imported via workspace package name with subpath `.js` exports:
```ts
import type { Event } from "@synapse/shared/handoff/types.js";
import { reduce } from "@synapse/shared/handoff/reducer.js";
import { EventKind } from "@synapse/shared/handoff/events.js";
```

**Node built-ins**: Always `node:` prefix — `import fs from "node:fs"`.

## Naming Conventions

- **Files**: `kebab-case.ts`, `kebab-case.test.ts`
- **Functions/variables**: `camelCase`
- **Types/interfaces**: `PascalCase`
- **Constants**: `SCREAMING_SNAKE_CASE` (module-level)
- **Wire/DB fields**: `snake_case` (`event_id`, `project_id`)
- **SvelteKit routes**: `+page.svelte`, `+page.server.ts`, `+layout.svelte`

## Control Flow — Handoff Loop (v1.1)

1. Claude Code hook fires → shells out `synapse hook <kind>` → `mcp/src/cli/hook-dispatch.ts` reads stdin JSON
2. Hook handler (`mcp/src/hooks/<kind>.ts`) translates to handoff events → `appendEvent()` writes to `events.jsonl`
3. Daemon (`mcp/src/capture/daemon.ts`) runs flush/pull cycle every 10s (jittered + exponential backoff on failure)
4. `POST /api/events/batch` (idempotent by ULID `event_id`) → backend recomputes `ProjectStatus` via the shared reducer
5. Daemon pulls `GET /api/projects/:id/status` → caches `brief.md`
6. Next SessionStart hook reads `brief.md` → emits `<synapse-brief>` block to stdout

**Project IDs**: First-run agents use `cwd_<sha1[0..12]>` placeholders. Backend resolves them to canonical UUIDs on first batch insert.

## Testing Patterns

**MCP tests** — isolate filesystem via `SYNAPSE_HOME` tmpdir:
```ts
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-test-");
  process.env.SYNAPSE_HOME = tmp;
  process.env.SYNAPSE_TEST_PROJECT_ID = "test-project";
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.SYNAPSE_HOME;     // biome-ignore: real delete required
  delete process.env.SYNAPSE_TEST_PROJECT_ID;
});
```

**Frontend env mocks** — `$env/dynamic/private` is aliased in `vitest.config.ts` to test mocks returning fixed values. To override for a single test, use `vi.doMock` + `vi.resetModules` + dynamic `import`.

**Backend tests** — use `@cloudflare/vitest-pool-workers` which simulates the Workers runtime. Most API tests are `worker.fetch()` based. ~10+ `.skip`'d tests are gated on "requires valid auth token + DB."

**E2E merge gate** — `npm run test:e2e` must pass before merging any change to `mcp/`, `backend/`, or `supabase/migrations/`. Exercises the live backend + daemon. Soft-skips when `claude` not on PATH (proxy scripts) or `SYNAPSE_API_KEY` missing (adapter-roundtrip). See `docs/E2E-PROTOCOL.md`.

## Gotchas

### Backend uses Supabase service-role key — RLS is defense-in-depth
`backend/src/db/client.ts` creates the client with `SUPABASE_SERVICE_KEY`, bypassing RLS. Authorization must be enforced in application code on every endpoint. Notable gap: `/api/events/batch` writes events without project membership check (see `.planning/codebase/CONCERNS.md`).

### Hardcoded production URLs
`https://api.synapsesync.app` is hardcoded in `mcp/src/cli/config.ts`, `mcp/src/cli/run-daemon.ts`, and several backend files. No env-override path for staging/self-hosted testing. The invite join URL, CORS allowlist, and daemon API target all embed the production domain.

### Dead LLM inference path
`maybeFireInferNextStep()` in `mcp/src/capture/daemon.ts:83` is never called in production. The daemon loop runs flush/pull/brief but never the LLM next-step inference path. The heuristic fallback (`heuristic-synth.ts`) is dead transitively.

### Two parallel daemon families in same directory
`mcp/src/capture/` houses both the legacy conversation-capture daemon (`capture-worker.ts`, `watcher.ts`, `store.ts`) and the new handoff daemon (`daemon.ts`, `handoff-sync.ts`). They share zero state, write to different locations, but coexist confusingly. `synapse capture start` and `synapse daemon` are both launchable.

### Frontend uses `$env/dynamic/private`, not `$env/static/private`
By design (v1.1 switch) — allows single build to deploy to multiple environments. Missing `API_URL` is caught at first request (500) not at build time. Don't "fix" this back to static imports.

### Biome: Svelte files lint-disabled
`.svelte` files have the linter off in `biome.json` overrides. Only the formatter runs on them. `svelte-check` handles Svelte type/lint concerns.

### Biome `noExplicitAny` override for `backend/src/mcp/agent.ts`
The Cloudflare Agents SDK uses `any` at the boundary; this single file has `noExplicitAny: "off"` in `biome.json` overrides.

### Zod version sensitivity
`mcp/` pins `zod` to exact `4.3.6` — the MCP SDK's zod-schema serialization is sensitive to minor versions. `backend/` uses `^4.3.6`. Coordinate updates carefully.

### `@modelcontextprotocol/sdk` version split
`mcp/` pins exactly `1.27.1`; `backend/` uses `^1.26.0`. They can drift — the MCP CLI and backend MCP server have different SDK copies.

### Env cleanup in tests needs `delete`, not `= undefined`
`process.env.X = undefined` won't remove the key. Use `delete process.env.X` with `// biome-ignore lint/performance/noDelete: real delete required`.

### SvelteKit `$env/dynamic/private` mock override
Top-level `vi.mock` won't work because the alias replaces the module. Use `vi.doMock` + `vi.resetModules` + dynamic `import()` pattern.

### Watermark writes even on malformed responses
`runFlushCycle` advances the flush watermark even when the backend response body is unparseable JSON. Events can be silently lost (see `.planning/codebase/CONCERNS.md`).

## Environment Variables

**Backend** (`backend/`): Set via `wrangler secret put`, typed in `backend/src/lib/env.ts`. Required: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `CREEM_API_KEY/WEBHOOK_SECRET/PRO_PRODUCT_ID`. Optional: `EMBEDDING_SERVICE_URL/KEY`, `COMPACTION_LLM_KEY`, `CORS_ORIGINS`. Local dev: copy `.dev.vars.example` → `backend/.dev.vars`.

**Frontend** (`frontend/`): `API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` in `frontend/.env`. Read via `$env/dynamic/private`.

**MCP**: `SYNAPSE_API_KEY` (required), `SYNAPSE_HOME` (defaults `~/.synapse`), `SYNAPSE_SOURCE` (defaults `claude`), `SYNAPSE_TEST_PROJECT_ID` (tests only), `SYNAPSE_DAEMON_SESSION=1` (prevents hook recursion).

## Error Handling

**Backend**: `AppError` class hierarchy (`errors.ts`) — `throw new NotFoundError("msg")`, never `return c.json({error}, 4xx)`. Central `app.onError` serializes to `{ error, code }`. Validation via `parseBody(c, schema)` which throws `AppError(issues, 400, "VALIDATION_ERROR")`.

**Frontend**: `ApiError(status, message)` — always `throw`, never return. SvelteKit `+error.svelte` boundary handles rendering.

**MCP**: `throw new Error("usage: ...")` — dispatcher catches and writes to stderr with exit 1.

**Logging**: `[tag] message` prefix pattern — `[auth]`, `[api]`, `[embeddings]`, `[billing]`, `[creem]`, `[compaction]`. Never log secrets or full JWTs.

## Key Dependencies

| Dep | Version | Where | Notes |
|-----|---------|-------|-------|
| Hono | ^4.12.8 | backend | HTTP router |
| SvelteKit | ^2.55 | frontend | SSR framework |
| Svelte | ^5.54 | frontend | Runes mode |
| `@modelcontextprotocol/sdk` | 1.27.1 (exact) / ^1.26.0 | mcp / backend | Coordinate updates |
| `agents` | ^0.7.9 | backend | Cloudflare McpAgent base |
| `@supabase/supabase-js` | ^2.99.2 | backend, frontend | |
| `@supabase/ssr` | ^0.9 | frontend | Cookie-based auth |
| Zod | 4.3.6 (exact) / ^4.3.6 | mcp / backend | Version-sensitive |
| Chokidar | ^5 | mcp | FS watcher |
| Biome | ^1.9 | root | Lint + format |
| Vitest | ^4.1 | all | Test runner |
| Wrangler | ^4.75 | backend | Worker dev/deploy |
| Tailwind CSS | ^4.2 | frontend | Styling |

## CI

**Verify** (every push): Node 22, `npm install`, `frontend/.env.example` → `frontend/.env`, `npm run verify` (lint + typecheck + test).

**E2E** (on push to main, requires `prod` environment): builds MCP, runs vitest E2E suite against secrets.

**Publish** (`mcp-v*` tags): npm trusted publishing with `--provenance`.

**Pre-push hook**: Runs `npm run verify` — adds ~25s per push.

## Decision Traps

- **Adding a new handoff event kind?** Update `EventKind` enum in `packages/shared/src/handoff/events.ts`, add the type in `types.ts`, handle it in the reducer, update tests. The reducer must stay pure.
- **Changing the reducer?** Tests in `packages/shared/test/handoff/reducer.test.ts` and `mcp/test/capture/` must pass. The server wrapper (`backend/src/lib/handoff-reducer.ts`) must stay in sync.
- **Adding a new MCP tool?** Add to `backend/src/mcp/tools/` for the Streamable HTTP surface. The legacy stdio MCP server (`mcp/src/index.ts`) only has `save_insight`/`list_insights` and is deprecated (removal target v2.0).
- **Adding a migration?** Number it, run `supabase db push`, verify with E2E before merge.
- **Touching the proxy subsystem?** Layer 5/7 E2E scripts exercise `claude` through the TLS-MITM proxy. Tests soft-skip without `claude` on PATH but the unit suite at `mcp/test/unit/capture/proxy/` is always runnable.
