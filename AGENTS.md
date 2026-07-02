# Synapse — Agent Orientation

Synapse captures AI coding sessions and surfaces cross-session insights. SvelteKit frontend → Cloudflare Workers backend → Supabase Postgres, plus an MCP CLI (`synapsesync`) that runs locally as a daemon.

**Repository mirroring:** `metanmai/synapse` (this repo) and `tanmain/synapse` (private) are kept in sync via a bidirectional sync bot. Commits have the same messages but **different commit hashes** across repos — never assume a hash from one repo exists in the other.

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

**Build note:** `mcp/` requires `tsc && node scripts/add-shebang.mjs` — the shebang script patches `dist/index.js` for CLI use. `backend/` has `"noEmit": true`, Wrangler builds on deploy. `@synapse/shared` has **no build step** — consumers import `.ts` source directly (requires Node 24 for native type-stripping on non-bundled consumers like CI).

**Test note:** `mcp/` tests use `node ./scripts/run-tests.mjs` (not raw `vitest run`) — this JSON-reporter wrapper tolerates vitest 4's teardown crash on Windows CI.

## Architecture at a Glance

```
CLI / Hooks (local)          Backend (CF Workers)        Supabase Postgres
───────────────────         ────────────────────        ─────────────────
synapsesync hook <kind>  ──▶ POST /api/events/batch ──▶  handoff_events
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
| `mcp/` | `synapsesync` | Node 24 ESM | `src/index.ts` (entry), `src/capture/` (daemon+log+sync+proxy+adapters), `src/hooks/` (6 Claude Code hook handlers), `src/cli/` (subcommands+editors), `src/capture/proxy/` (TLS-MITM forward proxy), `src/capture/adapters/` (8+ AI tool watchers) |
| `backend/` | `@synapse/backend` | CF Workers (Hono) | `src/index.ts` (router), `src/api/` (17 Hono sub-apps: auth, billing, events-batch, insights, invites, projects, share, etc.), `src/db/` (Supabase queries), `src/lib/` (auth, errors, embeddings, tier, rate-limit, Creem billing, LLM compaction), `src/mcp/` (Durable Object MCP server with 5 tool domains), `src/cron/` (daily aggregation + consolidation retry), `src/durable-objects/` (CompactionScheduler) |
| `frontend/` | `@synapse/frontend` | SvelteKit (Vite) | `src/routes/` (pages), `src/lib/server/` (SSR API client), `src/lib/components/` (Svelte 5) |
| `packages/shared/` | `@synapse/shared` | TypeScript only (no build) | `src/handoff/reducer.ts` (THE reducer), `src/handoff/types.ts`, `src/handoff/events.ts`. Ships raw `.ts` — consumers import source directly via Node 24 type-stripping or bundler. |
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

1. Claude Code hook fires → shells out `synapsesync hook <kind>` → `mcp/src/cli/hook-dispatch.ts` reads stdin JSON
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
`mcp/src/capture/` houses two independent daemons:
- **Capture daemon** (`capture-worker.ts`, `watcher.ts`, `store.ts`) — powers the frontend Conversations tab. Starts via `synapsesync capture start`. Uploads raw session transcripts to `POST /api/conversations`.
- **Handoff daemon** (`daemon.ts`, `handoff-sync.ts`) — powers cross-session briefs. Starts via `synapsesync daemon`. Flushes handoff events to `POST /api/events/batch` and pulls briefs back.

They share zero state, write to different locations, and have separate start/stop/status commands. Both are actively used — they serve different data pipelines. `synapsesync status` checks both (handoff first, falls back to capture).

### Multi-tool adapter system
`mcp/src/capture/adapters/` contains filesystem-watching adapters for 8+ AI tools: claude-code, cursor, codex, gemini, copilot-cli, cline, roo-code, opencode, crush. Each adapter knows the tool's session file paths and log formats. `adapter-registry.ts` discovers which tool is running by matching watch paths. A separate `mcp/src/cli/editors/` module detects installed editors (Claude Code, Cursor, VSCode, Windsurf) for setup orchestration.

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

### `@synapse/shared` ships raw `.ts` — no build, no JS output
`packages/shared/` has no `build` script and no `dist/`. Its `exports` map directly to `.ts` source files. Consumers must handle TypeScript themselves — the backend bundler (esbuild via Wrangler) handles it natively; the MCP CLI uses `tsc`; the frontend uses Vite. CI requires **Node 24** because of this (Node 24+ natively strips types from `.ts` imports). Never add a build step without updating CI and all consumers.

### `mcp` tests run through a JSON-reporter wrapper
`mcp/scripts/run-tests.mjs` wraps vitest to tolerate the "Worker exited unexpectedly" teardown crash on Windows CI (vitest 4 + tinypool fork shutdown race). The wrapper reads the JSON report and exits 0 when there are no test failures regardless of vitest's process exit code. Used by both `npm test` and CI.

### Proxy subsystem — TLS-MITM capture daemon
`mcp/src/capture/proxy/` is a standalone HTTP forward-proxy + HTTPS CONNECT tunneling daemon that captures AI tool API traffic. Two modes: plain HTTP proxy and TLS-MITM (per-host leaf certs). Currently buffers SSE responses end-to-end (no live streaming). Cross-platform backends in `backends/` (Linux, Mac, Windows). Connected to the adapter system via `proxy-source.ts` and `session-reconstruction.ts`.

## Environment Variables

**Backend** (`backend/`): Set via `wrangler secret put`, typed in `backend/src/lib/env.ts`. Required: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `CREEM_API_KEY/WEBHOOK_SECRET/PRO_PRODUCT_ID`. Optional: `EMBEDDING_SERVICE_URL/KEY`, `COMPACTION_LLM_KEY`, `CORS_ORIGINS`, `TIER_FREE_MAX_FILES`/`CONNECTIONS`/`HISTORY`/`MEMBERS`, `TIER_PLUS_MAX_FILES`/`CONNECTIONS`/`PRICE`, `APP_URL`. Local dev: copy `.dev.vars.example` → `backend/.dev.vars`.

**Frontend** (`frontend/`): `API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` in `frontend/.env`. Read via `$env/dynamic/private`.

**MCP**: `SYNAPSE_API_KEY` (required), `SYNAPSE_HOME` (defaults `~/.synapse`), `SYNAPSE_SOURCE` (defaults `claude`), `SYNAPSE_TEST_PROJECT_ID` (tests only), `SYNAPSE_DAEMON_SESSION=1` (prevents hook recursion).

## Error Handling

**Backend**: `AppError` class hierarchy (`errors.ts`) — `throw new NotFoundError("msg")`, never `return c.json({error}, 4xx)`. Central `app.onError` serializes to `{ error, code }`. Validation via `parseBody(c, schema)` which throws `AppError(issues, 400, "VALIDATION_ERROR")`.

**Frontend**: `ApiError(status, message)` — always `throw`, never return. SvelteKit `+error.svelte` boundary handles rendering.

**MCP**: `throw new Error("usage: ...")` — dispatcher catches and writes to stderr with exit 1.

**Logging**: `[tag] message` prefix pattern — `[auth]`, `[api]`, `[embeddings]`, `[billing]`, `[creem]`, `[compaction]`. Never log secrets or full JWTs.

## E2E Test Scripts

All E2E scripts live in `scripts/` and are `.mjs` files run with `node`. The main gate (`npm run test:e2e`) chains 5 scripts:

| Script | What it tests |
|--------|--------------|
| `e2e-happy-flow.mjs` | Daemon flush → backend → brief roundtrip |
| `e2e-adapter-roundtrip.mjs` | Multi-tool adapter event capture |
| `e2e-proxy-layer5.mjs` | CLI orchestration through TLS-MITM proxy |
| `e2e-proxy-source.mjs` | Proxy source attribution |
| `e2e-proxy-lifecycle.mjs` | Proxy daemon start/stop/restart |

Additional individual scripts: `e2e-failure-cases.mjs`, `e2e-multi-device.mjs`, `e2e-insight-roundtrip.mjs`, `e2e-insight-supersede.mjs`, `e2e-multi-account.mjs`, `e2e-resilience.mjs`, `e2e-cli.mjs`, `e2e-smoke.mjs`, `e2e-project-cap.mjs`, `e2e-conversation-lru.mjs`, `e2e-insight-cap.mjs`, `e2e-real-tool-roundtrip.mjs`, `e2e-llm-driver.mjs`. Cross-platform proxy install: `e2e-proxy-install-linux.mjs`, `e2e-proxy-install-windows.mjs`.

CI also runs **Playwright UI E2E** (`frontend/`, `npx playwright test`) with Chromium on both Linux and Windows.

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

**Verify** (every push): Node 24 (required for Windows — `@synapse/shared` ships raw `.ts`), `npm install`, `frontend/.env.example` → `frontend/.env`, `npm run verify` (lint + typecheck + test). Cross-OS matrix: ubuntu-latest + windows-latest.

**E2E** (on push to main, requires `prod` environment): cross-OS matrix (ubuntu + windows), builds MCP, runs vitest E2E suite, Playwright UI E2E tests. Gracefully skips when secrets not configured (mirror repos without secrets stay green).

**Migrate** (on push to main): applies pending Supabase migrations via `supabase db push --include-all`. Skips gracefully when `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` secrets not set.

**Publish** (`synapsesync-v*` tags): npm trusted publishing with `--provenance`. `prepublishOnly` runs `npm install && npm run build` to ensure fresh build. Provenance requires CI (GitHub Actions); local `npm publish` omits it.

**Pre-push hook**: Runs `npm run verify` — adds ~25s per push.

## Decision Traps

- **Adding a new handoff event kind?** Update `EventKind` enum in `packages/shared/src/handoff/events.ts`, add the type in `types.ts`, handle it in the reducer, update tests. The reducer must stay pure.
- **Changing the reducer?** Tests in `packages/shared/test/handoff/reducer.test.ts` and `mcp/test/capture/` must pass. The server wrapper (`backend/src/lib/handoff-reducer.ts`) must stay in sync.
- **Adding a new MCP tool?** Add to `backend/src/mcp/tools/` for the Streamable HTTP surface. Tools are organized by domain: context-capture, context-retrieval, conversations, insights, project-management. The legacy stdio MCP server (`mcp/src/index.ts`) only has `save_insight`/`list_insights` and is deprecated (removal target v2.0).
- **Adding a migration?** Number it, run `supabase db push`, verify with E2E before merge.
- **Touching the proxy subsystem?** Layer 5/7 E2E scripts exercise `claude` through the TLS-MITM proxy. Tests soft-skip without `claude` on PATH but the unit suite at `mcp/test/unit/capture/proxy/` is always runnable. Cross-platform backends live in `mcp/src/capture/proxy/backends/`.
- **Adding a new AI tool adapter?** Add to `mcp/src/capture/adapters/` implementing the `ToolAdapter` interface. Register in `default-registry.ts`. Update `CapturedSession.tool` union type in `mcp/src/capture/types.ts`.
- **Changing `@synapse/shared`?** No build step — changes to `.ts` files are immediately visible to all consumers. Test all three consumers (mcp, backend, frontend) after changes.
