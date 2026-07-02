# Coding Conventions

**Analysis Date:** 2026-05-15

## Naming Patterns

**Files:**
- `kebab-case.ts` for all TypeScript modules — verified across `backend/src/api/events-batch.ts`, `mcp/src/capture/handoff-sync.ts`, `mcp/src/cli/handoff-arg-parse.ts`, `frontend/src/lib/server/api.ts`.
- `kebab-case.test.ts` for unit/integration tests — e.g. `mcp/test/cli/cli-dispatcher.test.ts`, `backend/test/lib/errors.test.ts`.
- `<thing>.e2e.test.ts` or `e2e/` subdirectory for end-to-end tests — e.g. `mcp/test/e2e/handoff.e2e.test.ts`, `mcp/test/e2e/api-roundtrip.test.ts`.
- `<thing>.bench.test.ts` for performance benchmarks — e.g. `mcp/test/perf/hook-latency.bench.test.ts`.
- `+page.svelte` / `+page.server.ts` / `+layout.svelte` for SvelteKit routes — e.g. `frontend/src/routes/login/+page.server.ts`.

**Functions:**
- `camelCase` — `runHandoffCmd`, `parseHandoffArgs`, `resolveActor`, `appendEvent`, `hashApiKey`, `findUserByApiKeyHash`.
- Top-level handlers exported by name and re-collected into dispatch maps (see `mcp/src/cli/handlers.ts` HANDLERS, `backend/src/lib/validate.ts` schemas).

**Variables:**
- `camelCase` for locals and module-level — `apiKeyHash`, `projectId`, `tanmaiHome`.
- `SCREAMING_SNAKE_CASE` for module-level constants — `API_URL` (`mcp/src/cli/config.ts`), `EMBEDDING_TIMEOUT_MS` (`backend/src/lib/constants.ts`), `HOOK_BIN`, `SLASH_COMMANDS`, `HOOK_DEFS` (`mcp/src/cli/init.ts`), `FAKE_UUID` (test files), `ENCODING` (`mcp/src/capture/events-log.ts`).
- Backend env var keys use `SCREAMING_SNAKE_CASE` and are typed via the `Env` interface in `backend/src/lib/env.ts`.

**Types:**
- `PascalCase` interfaces and type aliases — `Event`, `Actor`, `Project`, `Env`, `HandlerContext`, `ApiError`, `AppError`, `NotFoundError`, `EmbeddingConfig`, `Subtask`.
- `EventKind` (`packages/shared/src/handoff/events.ts`) uses `PascalCase` for both the type name and the const-object member keys, with `snake_case` string values that match wire format: `EventKind.NextStepSet = "next_step_set"`.
- Wire-format / DB-row fields use `snake_case` (`event_id`, `project_id`, `attached_to`, `occurred_at`, `received_at`) and are preserved through to JSON.
- Re-export types via barrel files: `packages/shared/src/types.ts` re-exports `./conversations` and `./insights`; `packages/shared/package.json` exports `./handoff/types.js`, `./handoff/events.js`, `./handoff/reducer.js` as subpaths.

## Code Style

**Formatter / Linter — Biome (single tool):**
- Config: `biome.json` at the repo root, version `^1.9.0` (see root `package.json`).
- `formatter`: `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 120`.
- `organizeImports.enabled: true` — Biome auto-orders imports on save / `biome check --write`.
- `linter.rules.recommended: true` plus repo-specific overrides:
  - `suspicious.noExplicitAny: "warn"` — `any` is allowed for narrow escape hatches but each use carries a `// biome-ignore` directive with rationale.
  - `style.noNonNullAssertion: "warn"` — `!` postfix is discouraged.
  - `style.useConst: "error"` — `let` is only used when reassignment is needed.
  - `correctness.noUnusedVariables: "warn"`.
  - `correctness.noUnusedImports: "error"` — dead imports fail CI.
- Ignored paths: `node_modules`, `dist`, `build`, `.svelte-kit`, `.wrangler`, `*.min.js`.
- Overrides:
  - `*.svelte` — linter disabled (formatter still runs; Svelte syntax outside Biome's scope).
  - `backend/src/mcp/agent.ts` — `noExplicitAny: "off"` (Cloudflare Agents SDK boundary).

**Running the linter / formatter:**
```bash
npm run lint           # biome check .              (CI + pre-push)
npm run lint:fix       # biome check --write .      (auto-fix)
npm run format         # biome format --write .     (format only)
```
Standard one-file fix: `npx biome check --write <path>`.

**Suppression style:**
- Only inline ignores, scoped per-rule: `// biome-ignore lint/performance/noDelete: real delete required` (used wherever an env-var or property must actually be removed — see `mcp/test/cli/cli-dispatcher.test.ts:96-99`, `mcp/test/e2e/handoff.e2e.test.ts:24-25`).
- `// biome-ignore lint/suspicious/noExplicitAny: <reason>` for the few `any` casts in test plumbing (`mcp/test/cli/cli-dispatcher.test.ts:34-49`).
- `// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Supabase query chains` in `backend/test/db/mock-supabase.ts:47`.
- Every ignore carries a real reason — never a bare `// biome-ignore`.

## Import Organization

**Order (enforced by Biome `organizeImports`):**
1. Node built-ins, with the `node:` protocol prefix — `import fs from "node:fs"`, `import path from "node:path"`, `import { randomBytes } from "node:crypto"`, `import http from "node:http"`. Mandatory across the repo.
2. Third-party packages — `import { Hono } from "hono"`, `import { z } from "zod"`, `import { describe, expect, it, vi } from "vitest"`, `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`.
3. Workspace packages (scoped) — `import type { Event } from "@synapse/shared/handoff/types.js"`, `import { reduce } from "@synapse/shared/handoff/reducer.js"`, `import { EventKind } from "@synapse/shared/handoff/events.js"`.
4. Frontend-only aliases — `import { env } from "$env/dynamic/private"`, `import type { Cookies } from "@sveltejs/kit"`, `import { getSupabase } from "$lib/server/auth"`.
5. Relative imports — `./` and `../` paths last.

**File extensions on relative imports:**
- `mcp` (Node ESM, `tsconfig` `module: Node16`) — relative imports MUST include `.js` extension even when the source is `.ts`: `import { resolveActor } from "../capture/actor.js"`. See every file under `mcp/src/`.
- `backend` (Cloudflare Workers, `moduleResolution: bundler`) — relative imports omit extensions: `import { authMiddleware } from "../lib/auth"`. See `backend/src/index.ts`.
- `frontend` (Vite, `moduleResolution: bundler`) — no extension on relative imports.
- `packages/shared` exports subpaths as `.js` aliases (see `packages/shared/package.json` `exports`), so external consumers always import with `.js`.

**Path Aliases:**
- Frontend (`frontend/vitest.config.ts`):
  - `$lib` → `/src/lib`
  - `$lib/*` → `/src/lib/*`
  - `$app/environment` → `/src/test-mocks/app-environment.ts` (tests only)
  - `$env/static/private` → `/src/test-mocks/env-private.ts` (tests only)
  - `$env/dynamic/private` → `/src/test-mocks/env-dynamic-private.ts` (tests only)
- Backend / MCP — no path aliases. Relative paths only.

## Environment Variables

**Backend (Cloudflare Workers) — typed bindings:**
- All env vars declared as fields on the `Env` interface in `backend/src/lib/env.ts`. The Hono app uses `new Hono<{ Bindings: Env }>()` (`backend/src/index.ts:28`) so `c.env.<KEY>` is statically typed.
- Required vars throw at first use (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRO_PRODUCT_ID`).
- Optional vars use the `envOr` / `envList` helpers in `backend/src/lib/env.ts` — never read `c.env.X ?? "default"` inline.
  ```ts
  const origins = envList(c.env, "CORS_ORIGINS", "http://localhost:5173,https://synapsesync.app,...");
  ```

**Frontend (SvelteKit) — `$env/dynamic/private` only:**
- Read with `import { env } from "$env/dynamic/private"` and access fields off `env` (e.g. `env.API_URL`, `env.SUPABASE_URL`, `env.SUPABASE_ANON_KEY`). See `frontend/src/lib/server/api.ts:1-3` and `frontend/src/lib/server/auth.ts:1-8`.
- Never use `$env/static/private` for runtime values — the static form locks values to build time, which broke deploys before the v1.1 switch.
- `$env/static/private` is still mocked in tests (`frontend/src/test-mocks/env-private.ts`) for any legacy callers, but new code uses `$env/dynamic/private`.
- Missing-value handling: callers throw with a precise message — see `frontend/src/lib/server/api.ts:15-17` (`"API_URL is not configured. Set it in your environment variables."`) and `frontend/src/lib/server/auth.ts:8-9`.

**MCP / CLI — Node `process.env`:**
- Read directly: `process.env.SYNAPSE_HOME`, `process.env.SYNAPSE_API_KEY`, `process.env.SYNAPSE_DAEMON_SESSION`, `process.env.SYNAPSE_TEST_PROJECT_ID`.
- Resolved through helpers when the value drives a filesystem path:
  ```ts
  // mcp/src/capture/handoff-paths.ts
  export function synapseRoot(): string {
    return process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  }
  ```
- Constants live in `mcp/src/cli/config.ts` (e.g. `API_URL = "https://api.synapsesync.app"`).

## Error Handling

**Backend — `AppError` class hierarchy (`backend/src/lib/errors.ts`):**
- Base: `AppError(message, status = 500, code = "INTERNAL_ERROR")`.
- Subclasses set status + code: `NotFoundError` (404 / `NOT_FOUND`), `UnauthorizedError` (401 / `UNAUTHORIZED`), `ForbiddenError` (403 / `FORBIDDEN`), `ConflictError` (409 / `CONFLICT`).
- Route handlers `throw new <Error>("message")` — never `return c.json({error}, 4xx)` inline. Central `app.onError` in `backend/src/index.ts:51-65` serialises `AppError` into `{ error, code }` with the right status; unknown errors become 500 with `INTERNAL_ERROR` and a console.error.
- Validation errors come from `parseBody(c, schema)` in `backend/src/lib/validate.ts` which throws `new AppError(issues, 400, "VALIDATION_ERROR")` when a Zod schema fails. All POST/PATCH handlers funnel through this.
- Test the contract by hitting endpoints with `worker.fetch` and asserting status + `body.error` + `body.code` (see `backend/test/lib/errors.test.ts:14-18`).

**Frontend — `ApiError` class (`frontend/src/lib/server/api.ts:5-12`):**
- Used by every `+page.server.ts` load/action and any server-side fetch.
- Constructor: `ApiError(status: number, message: string)` — same shape as backend, no `code` field (status is enough for branch logic in the load function).
- Network failures map to `ApiError(503, "Cannot reach API at ...")`; missing `API_URL` maps to `ApiError(500, "API_URL is not configured...")`; non-2xx responses lift `body.error` + optional `body.detail` into the message.
- Always `throw`, never return. The SvelteKit `+error.svelte` boundary handles rendering.

**MCP — `throw new Error(...)` with usage strings; handlers never return error codes:**
- CLI arg parsers throw with the usage line: `throw new Error('usage: synapse handoff "<text>"')` (`mcp/src/cli/handoff-arg-parse.ts:16`). The dispatcher in `mcp/src/cli/handlers.ts` catches and writes to stderr with exit code 1 (see `cli-dispatcher.test.ts:74-83`).
- Hook handlers (`runPostToolUseHook`, `runSessionStartHook`) are fire-and-forget — they short-circuit on guard env vars (`SYNAPSE_DAEMON_SESSION === "1"`) and otherwise append events without throwing on transient FS errors.
- Network operations (sync, invite) throw on non-2xx; callers in `mcp/src/cli/invite.ts` print a one-line error and exit non-zero.

**Shared rule — error messages cite the failing operation:**
- `"Cannot reach API at ${API_URL}${path}: ${err.message}"` not `"Network error"`.
- `"No user found with email ${email}"` not `"Not found"`.
- `"invite failed: ${status}"` not `"Request failed"`.

## Logging

**Framework:** plain `console.log` / `console.warn` / `console.error`. No structured logger or wrapper.

**Tag prefix pattern:** `[<area>] message` — e.g. `[auth] Supabase getUser failed:`, `[embeddings] Service returned 500: ...`, `[error] GET /api/projects:`, `[api] GET http://localhost:8787/api/projects`, `[synapse init] OS service registered: ...`.
- `[api]` for outbound HTTP from the SvelteKit server-side fetcher (`frontend/src/lib/server/api.ts:29`).
- `[auth]` for auth middleware (`backend/src/lib/auth.ts:49,53,58,72`).
- `[embeddings]` for the embedding-service client (`backend/src/lib/embeddings.ts:43,50`).
- `[error]` for the global error handler (`backend/src/index.ts:55`).

**When to log:**
- Network / external service failures — log full status + body once.
- Auth misses that aren't user error (e.g. JWT verifies but no row in `public.users`) — `console.error` with a remediation hint.
- Never log secrets, full API keys, or full JWTs. Hash + truncate if needed.

**Tests silence noisy logs:** `vi.spyOn(console, "log").mockImplementation(() => {})` in the `beforeEach` (see `frontend/src/lib/server/api.test.ts:31`).

## Function Design

**Size:** Functions stay small — most exported functions in `mcp/src/cli/handoff-commands.ts` and `backend/src/api/projects.ts` are 10-30 lines. Composition via helpers preferred over inline branching.

**Parameters:** Single object argument when there are more than two params. Pattern: `function runHandoffCmd(a: Base & { text: string })` where `Base = { project_id, user_id, session_id }` (`mcp/src/cli/handoff-commands.ts:13-30`). Avoids positional ambiguity and keeps call sites readable.

**Return values:**
- Backend route handlers return `c.json(payload, status)` — never raw `Response`.
- MCP CLI commands return `Promise<void>` and signal via stdout/stderr + appendEvent side-effects.
- Pure helpers (reducer, parsers) return typed result objects; throwing for invalid input.
- Dependency-injection for testability: `embedTexts(texts, type, config, fetchFn = globalThis.fetch)` in `backend/src/lib/embeddings.ts:18-23` accepts an injectable `fetchFn` so tests pass `vi.fn()` directly without `vi.stubGlobal`.

**Async style:** `async/await` everywhere; no raw `.then()` chains. Promise rejections are caught at the route / handler boundary.

## Module Design

**Exports:**
- Named exports only — no `export default` except where a framework requires it (`backend/src/index.ts:96-105` exports a default fetch handler for Cloudflare Workers; SvelteKit `+page.server.ts` exports named `load` / `actions`).
- Interfaces and types are exported alongside the functions that consume them (`interface InitArgs` in `mcp/src/cli/init.ts:6-9`, `interface ParsedHandoff` in `mcp/src/cli/handoff-arg-parse.ts:10-12`).

**Barrel files:**
- `packages/shared/src/types.ts` is the canonical barrel — re-exports every domain type via `export type { ... } from "./insights"` and `export type { ... } from "./conversations"` (see `packages/shared/src/types.ts:77-94`).
- Submodule barrels per feature: `packages/shared/src/handoff/types.ts`, `packages/shared/src/handoff/events.ts`, `packages/shared/src/handoff/reducer.ts` exposed individually through `packages/shared/package.json` `exports` (`./handoff/types.js`, etc.) — consumers `import` the exact submodule they need, no transitive bloat.
- MCP and backend do not maintain barrel files — every consumer imports directly from the source module.

**Dispatch maps over switch statements:**
- `mcp/src/cli/handlers.ts` defines `HANDLERS: Record<string, (args: string[]) => Promise<void>>` (see line 129) — the entry point in `mcp/src/index.ts` looks up the cmd in the map. Tests bypass the entry-point bootstrap and call `HANDLERS[cmd]` directly (`mcp/test/cli/cli-dispatcher.test.ts:69-75`).
- `backend/src/lib/validate.ts` exports a `schemas` object keyed by operation name (`schemas.createProject`, `schemas.addMember`, etc., lines 21-167). Route handlers call `parseBody(c, schemas.<op>)` rather than re-declaring Zod shapes inline.

## TypeScript Configuration

**Common across all workspaces (`tsconfig.json` per workspace):**
- `strict: true`, `skipLibCheck: true`, `esModuleInterop: true` (where applicable), `isolatedModules: true`, `forceConsistentCasingInFileNames: true`, `resolveJsonModule: true`.

**Per-workspace differences:**
- `mcp/tsconfig.json` — `target: ES2022`, `module: Node16`, `moduleResolution: Node16`, emits to `dist/` with `declaration: true`. Drives the `.js` extension requirement on relative imports.
- `backend/tsconfig.json` — `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `noEmit: true`, types: `["@cloudflare/vitest-pool-workers/types", "@cloudflare/workers-types/experimental"]`.
- `frontend/tsconfig.json` — extends `./.svelte-kit/tsconfig.json`, adds `allowJs: true`, `checkJs: true`, `sourceMap: true`.
- `packages/shared/tsconfig.json` — `noEmit: true`, source is consumed directly via the workspace `main: "./src/types.ts"` field.

**Run typecheck:**
```bash
npm run typecheck                # all workspaces (root)
npm run typecheck -w mcp         # single workspace
```
Frontend's `typecheck` aliases to `svelte-kit sync && svelte-check`, not raw `tsc`.

## Pre-push Verification

`.git/hooks/pre-push` (a Husky-style hook installed at the standard git path, not the `.husky/` directory) runs `npm run verify` which fans out to `npm run lint && npm run typecheck && npm run test` across all workspaces (root `package.json:12`). NEVER use `git push --no-verify` — CI runs the same gate and a skipped local hook just defers the same failure to CI.

```bash
# .git/hooks/pre-push
#!/bin/sh
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
echo "Running pre-push verification (lint + typecheck + test)..."
npm run verify
```

---

*Convention analysis: 2026-05-15*
