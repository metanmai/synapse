# Testing Patterns

**Analysis Date:** 2026-05-15

## Test Framework

**Runner:** Vitest `^4.1` across every workspace.
- `mcp` — `vitest ^4.1.2` (devDep in `mcp/package.json`). Config: `mcp/vitest.config.ts`.
- `backend` — `vitest ^4.1.0` with `@cloudflare/vitest-pool-workers ^0.13.2`. Config: `backend/vitest.config.ts`.
- `frontend` — `vitest ^4.1.0`. Config: `frontend/vitest.config.ts`.
- `packages/shared` — same Vitest version; no local config (uses Vitest defaults; tests live under `packages/shared/test/`).

**Assertion Library:** Vitest's built-in `expect` (`describe`, `it`, `expect`, `beforeEach`, `afterEach`, `afterAll`, `vi`). `globals: true` is set everywhere, so the destructured imports `import { describe, expect, it, vi } from "vitest"` are stylistic — they're used consistently across files for clarity.

**Run Commands:**
```bash
# From repo root — runs every workspace, gated by pre-push and CI
npm run test

# Per workspace
cd mcp       && npx vitest run            # 309 passed / 171 skipped / 485 total across 51 files
cd backend   && npx vitest run            # 360 passed / 12 skipped / 372 total across 29 files
cd frontend  && npx vitest run            # 65 passed / 65 total across 4 files
cd packages/shared && npx vitest run      # 13 passed / 13 total across 2 files

# MCP E2E suite (gated by env var)
cd mcp && TEST_E2E=1 npm run test:e2e     # test/e2e/api-roundtrip.test.ts and friends

# Watch
cd <workspace> && npx vitest              # implicit watch mode
```

Aggregate counts (`npm run test` from root): **747 passing tests across 86 test files** plus 248 environment-gated skips (mostly the live-API roundtrip suite and Wrangler-only paths).

## Test File Organization

**Location — separate `test/` directory mirrors `src/`:**
- `mcp/test/` mirrors `mcp/src/` — `mcp/src/capture/events-log.ts` ↔ `mcp/test/capture/events-log.test.ts`; `mcp/src/cli/handlers.ts` ↔ `mcp/test/cli/cli-dispatcher.test.ts`.
- `backend/test/` mirrors `backend/src/` — `backend/src/lib/errors.ts` ↔ `backend/test/lib/errors.test.ts`; `backend/src/api/projects.ts` ↔ `backend/test/api/projects.test.ts`.
- `packages/shared/test/` mirrors `packages/shared/src/` — `packages/shared/src/handoff/reducer.ts` ↔ `packages/shared/test/handoff/reducer.test.ts`.
- **Exception — frontend co-locates:** `frontend/src/lib/server/api.ts` ↔ `frontend/src/lib/server/api.test.ts` (same directory). Driven by `frontend/vitest.config.ts` `include: ["src/**/*.test.ts"]`.

**Naming:**
- All tests end in `.test.ts`.
- E2E tests use either an `e2e/` subdirectory (`mcp/test/e2e/`) or `.e2e.test.ts` suffix (`mcp/test/e2e/handoff.e2e.test.ts`).
- Benchmarks: `.bench.test.ts` under `test/perf/` (`mcp/test/perf/hook-latency.bench.test.ts`, `brief-render.bench.test.ts`, `init-time.bench.test.ts`). Still run by the default Vitest invocation — they're framed as `expect(elapsed).toBeLessThan(...)` rather than Vitest's `bench` API.
- No `*.spec.ts` — repo convention is `*.test.ts` only.

**MCP test directory structure (canonical):**
```
mcp/test/
├── capture/        # filesystem + sync layer unit tests (11 files)
├── cli/            # CLI command + dispatcher tests (9 files)
├── e2e/            # end-to-end + stub backends (5 + helper)
├── fixtures/       # captured-session fixtures by adapter
│   └── capture/{claude-code,cursor,codex,gemini}/
├── hooks/          # Claude-Code hook handler tests (4 files)
├── integration/    # encryption etc. (1 file)
├── perf/           # latency benchmarks (3 files)
└── unit/           # pure-function tests (8 files + capture/ subdir)
```
The `mcp/vitest.config.ts` `include` array lists each subdirectory explicitly so a stray test file lives in the right bucket or doesn't run at all.

**Backend test directory:**
```
backend/test/
├── api/            # route-level tests via worker.fetch (14 files)
├── db/             # query + mock-supabase helpers (3 files + mock-supabase.ts)
├── lib/            # pure-function helpers (12 files)
└── setup.ts        # re-exports cloudflare:test helpers
```

## Test Structure

**Suite organization (canonical pattern from `mcp/test/cli/cli-dispatcher.test.ts`):**
```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HANDLERS } from "../../src/cli/handlers.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-dispatch-");
  process.env.SYNAPSE_HOME = tmp;
  process.env.SYNAPSE_TEST_PROJECT_ID = "test-project";
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_TEST_PROJECT_ID;
});

describe("CLI dispatcher — handoff layer subcommands", () => {
  it("`synapse handoff '<text>'` writes a next_step_set event", async () => {
    const { code } = await runCli("handoff", "wire", "/callback");
    expect(code).toBe(0);
    const events = readEvents();
    expect(events[0].kind).toBe("next_step_set");
  });
});
```

**Patterns:**
- Each test file owns its own `beforeEach`/`afterEach` to isolate state. No global setup file except `backend/test/setup.ts` (a tiny re-export of `cloudflare:test` helpers).
- One top-level `describe` per module-under-test, sometimes grouped by behaviour (`describe("createApi")`, `describe("request (via API methods)")`, `describe("ApiError")` in `frontend/src/lib/server/api.test.ts`).
- `it("descriptive sentence with backticks for the surface under test")` — assertions read like specs.
- Setup creates a fresh tmpdir via `fs.mkdtempSync("/tmp/<prefix>-")`; teardown does `fs.rmSync(tmp, { recursive: true, force: true })` and `delete process.env.X`. The `delete` lines carry `// biome-ignore lint/performance/noDelete: real delete required` because the lint rule wants `= undefined` but env-var cleanup needs an actual delete.

## Mocking

**Framework:** Vitest's built-in `vi` (`vi.fn`, `vi.stubGlobal`, `vi.mock`, `vi.doMock`, `vi.spyOn`, `vi.restoreAllMocks`).

### Frontend env mocks (`$env/dynamic/private` and `$env/static/private`)

SvelteKit's `$env/*` modules don't exist outside the framework's bundler, so `frontend/vitest.config.ts` aliases them to plain test mocks:

```ts
// frontend/vitest.config.ts:11-14
alias: {
  $lib: "/src/lib",
  "$lib/*": "/src/lib/*",
  "$app/environment": "/src/test-mocks/app-environment.ts",
  "$env/static/private": "/src/test-mocks/env-private.ts",
  "$env/dynamic/private": "/src/test-mocks/env-dynamic-private.ts",
},
```

The mocks return fixed test values:
```ts
// frontend/src/test-mocks/env-dynamic-private.ts
export const env: Record<string, string | undefined> = {
  API_URL: "http://localhost:8787",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
};

// frontend/src/test-mocks/env-private.ts
export const API_URL = "http://localhost:8787";

// frontend/src/test-mocks/app-environment.ts
export const browser = false;
export const dev = true;
```

To override `env` for a single test, use `vi.doMock` + `vi.resetModules` + dynamic `import` (the alias means a top-level `vi.mock` would be replaced rather than overridden):

```ts
// frontend/src/lib/server/api.test.ts:217-234
it("throws ApiError(500) when API_URL is empty", async () => {
  vi.doMock("$env/dynamic/private", () => ({ env: { API_URL: "" } }));
  vi.resetModules();
  const mod = await import("./api");
  const api = mod.createApi("token");
  // ...
  vi.doUnmock("$env/dynamic/private");
});
```

### MCP `SYNAPSE_HOME` tmpdir pattern (filesystem isolation)

Every MCP test that touches the local event log overrides `SYNAPSE_HOME` to a `mkdtemp` directory. The production code reads from `process.env.SYNAPSE_HOME` via `synapseRoot()` in `mcp/src/capture/handoff-paths.ts:4-6`, so tests just have to set the env var and the entire CLI / hook / sync layer follows.

```ts
// mcp/test/cli/cli-dispatcher.test.ts:86-100
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-dispatch-");
  process.env.SYNAPSE_HOME = tmp;
  process.env.SYNAPSE_TEST_PROJECT_ID = TEST_PROJECT_ID;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_TEST_PROJECT_ID;
});
```

Used identically in `mcp/test/cli/init.test.ts:8-19`, `mcp/test/cli/invite.test.ts:9-21`, `mcp/test/hooks/session-start.test.ts:8-16`, `mcp/test/capture/handoff-sync.test.ts:7-16`, `mcp/test/perf/hook-latency.bench.test.ts:6-14`. The `SYNAPSE_TEST_PROJECT_ID` override is a second knob handled by `resolveProjectFromCwd` in `mcp/src/cli/handlers.ts:78-80` — it short-circuits the cwd→project map for deterministic test IDs.

Multi-device handoff E2E uses two tmpdirs and swaps `SYNAPSE_HOME` between them mid-test to simulate two machines:
```ts
// mcp/test/e2e/handoff.e2e.test.ts:17-26
tanmaiHome = fs.mkdtempSync("/tmp/syn-tanmai-");
alexHome = fs.mkdtempSync("/tmp/syn-alex-");
// ... later in the test:
process.env.SYNAPSE_HOME = tanmaiHome;  // Monday
// ... drain queue, then:
process.env.SYNAPSE_HOME = alexHome;    // Tuesday
```

### Fetch mocking

**Stub global fetch with `vi.stubGlobal` / direct assignment:**
```ts
// frontend/src/lib/server/api.test.ts:78
const fetchMock = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});
vi.stubGlobal("fetch", fetchMock);
```

```ts
// mcp/test/cli/invite.test.ts:26-36
global.fetch = vi.fn(async (url, init) => {
  captured.push({ url: String(url), init });
  return new Response(JSON.stringify({ token: "tok123", ... }), { status: 200 });
}) as typeof fetch;
```

**Stub-backend HTTP server for E2E:** `mcp/test/e2e/stub-backend.ts` boots a real `node:http` server on a random port that handles `/api/events/batch` and `/api/projects/:id/status` by replaying through `@synapse/shared/handoff/reducer`. Real fetch, real network, deterministic responses, no Cloudflare dependency. Used by `mcp/test/e2e/handoff.e2e.test.ts`.

**Injectable fetch for unit tests:** Production functions accept an optional `fetchFn` parameter so tests pass `vi.fn()` directly without stubbing globals:
```ts
// backend/src/lib/embeddings.ts:18-23
export async function embedTexts(
  texts: string[],
  type: EmbedType,
  config: EmbeddingConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<number[][] | null>
```
Test (`backend/test/lib/embeddings.test.ts:17-33`):
```ts
const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ embeddings: [FAKE_VECTOR] }) });
const result = await embedTexts(["hello"], "search_query", makeConfig(), mockFetch);
expect(mockFetch).toHaveBeenCalledOnce();
```

### Supabase mocking (`backend/test/db/mock-supabase.ts`)

Backend tests that need to assert against Supabase query chains use a custom thenable mock that returns the same proxy for every chain method:
```ts
// backend/test/db/mock-supabase.ts:14-54
export function createMockDb(response = {}) {
  const chainable: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "like", "or",
                   "overlaps", "order", "limit", "range", "textSearch"]) {
    chainable[m] = vi.fn().mockReturnValue(chainable);
  }
  chainable.single = vi.fn().mockResolvedValue(response);
  chainable.maybeSingle = vi.fn().mockResolvedValue(response);
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Supabase query chains
  chainable.then = (resolve) => resolve(response);
  return { from: vi.fn().mockReturnValue(chainable), rpc: vi.fn().mockResolvedValue(response), chainable };
}
```
Shorthands: `mockSuccess(data)`, `mockError(message, code)`, `mockNoRows()`.

For `vi.mock("@supabase/supabase-js")` see `backend/test/lib/auth.test.ts:18-25`.

### Backend Worker fetch (Cloudflare-specific)

Backend route tests use `@cloudflare/vitest-pool-workers`. The pool spins up a Miniflare worker per test and exposes Worker helpers via `cloudflare:test`:
```ts
// backend/test/setup.ts
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
export { env, createExecutionContext, waitOnExecutionContext };
```
Route tests do real `worker.fetch(req, env, ctx)` calls against the worker entry point:
```ts
// backend/test/api/projects.test.ts:7-12
const req = new Request("http://localhost/api/projects");
const ctx = createExecutionContext();
const res = await worker.fetch(req, env, ctx);
await waitOnExecutionContext(ctx);
expect(res.status).toBe(401);
```
Driven by `backend/vitest.config.ts`:
```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
```

### Stdout / stderr capture

CLI tests intercept `process.stdout.write` / `process.stderr.write` instead of mocking `console`:
```ts
// mcp/test/cli/cli-dispatcher.test.ts:29-56
function captureStdio(): void {
  stdoutChunks = []; stderrChunks = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  // biome-ignore lint/suspicious/noExplicitAny: matching node's overloaded write signature is awkward to type fully
  (process.stdout.write as any) = (chunk, ...rest) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof rest[0] === "function") rest[0]();
    return true;
  };
  // ... restore on teardown
}
```
Hook tests use a fake `WriteStream` shaped object passed directly to the hook:
```ts
// mcp/test/hooks/session-start.test.ts:19-26
const out: string[] = [];
const stdout = { write: (s: string) => { out.push(s); return true; } } as unknown as NodeJS.WriteStream;
await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, skipFallback: true });
```

### What to Mock vs. What NOT to Mock

**Mock:**
- External HTTP services (Supabase, Creem, embedding service, the Synapse backend itself when testing MCP).
- Cloud sync flush / pull cycles (use stub-backend or `vi.fn`).
- Time-sensitive paths: pass a `now: new Date(...)` argument to the reducer rather than mocking the clock (`packages/shared/src/handoff/reducer.ts` accepts an options bag — see `packages/shared/test/handoff/reducer.test.ts:67-72`).
- SvelteKit `$env/*` (mandatory — no other way to set it outside the bundler).

**Don't mock:**
- The local event log, project map, or any filesystem path under `SYNAPSE_HOME`. Use a tmpdir and let the real FS code run — that's the whole point of the `SYNAPSE_HOME` override.
- Pure functions like `reduce`, `parseHandoffArgs`, `resolveActor`, `hashApiKey`. Call them directly.
- The Hono router or Cloudflare runtime in backend route tests — let the worker pool spin up a real Miniflare instance.

## Fixtures and Factories

**Per-adapter capture fixtures (`mcp/test/fixtures/capture/`):**
- `claude-code/`, `cursor/`, `codex/`, `gemini/` — each holds sample session JSONL files that the adapter tests parse end-to-end.
- Verified in `mcp/test/unit/capture/claude-code.test.ts`, `cursor.test.ts`, `codex.test.ts`, `gemini.test.ts`.

**Inline factory helpers per test file:**
```ts
// packages/shared/test/handoff/reducer.test.ts:9-22
function ev(over: Partial<Event>): Event {
  return {
    event_id: over.event_id ?? Math.random().toString(36).slice(2),
    project_id: "p", session_id: "s", actor: A1, attached_to: null,
    kind: EventKind.ToolUsed,
    occurred_at: "2026-05-11T09:00:00Z",
    received_at: "2026-05-11T09:00:00Z",
    payload: {},
    ...over,
  };
}
```

```ts
// mcp/test/capture/handoff-sync.test.ts:50-62
function makeEv(id: string) {
  return {
    event_id: id, project_id: "p1", session_id: "s",
    actor: { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null, kind: "session_opened" as const,
    occurred_at: "2026-05-11T09:00:00Z", received_at: "2026-05-11T09:00:01Z", payload: {},
  };
}
```

```ts
// backend/test/lib/embeddings.test.ts:6-13
function makeConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  return { url: "http://fake-embed:8080", key: "test-key", timeoutMs: 3000, ...overrides };
}
```

**Constants for invariants:**
- `FAKE_UUID = "00000000-0000-0000-0000-000000000000"` (`backend/test/api/conversations.test.ts:5`) — used wherever a Zod schema requires `.uuid()` but the test only cares about the auth boundary.
- `FAKE_VECTOR = Array.from({ length: 768 }, (_, i) => i / 768)` — a deterministic stand-in for embedding-service responses.

**Location:** All fixtures live under `test/fixtures/` or inline at the top of the test file. No top-level `fixtures/` directory in the repo root.

## Coverage

**Requirements:** No coverage threshold enforced in CI. The pre-push gate is `npm run verify` = lint + typecheck + test (all assertions pass). No `--coverage` step in any workspace `test` script.

**View Coverage (ad hoc):**
```bash
cd <workspace>
npx vitest run --coverage          # default text + HTML report at ./coverage/
```
`vitest` v4 ships `@vitest/coverage-v8` as the default provider — no additional dep needed.

## Test Types

**Unit Tests (majority):**
- Pure functions: reducers, parsers, formatters, hashers, validators.
- Scope: one module per test file; no I/O beyond the tmpdir filesystem allowed under `SYNAPSE_HOME`.
- Examples: `packages/shared/test/handoff/reducer.test.ts`, `mcp/test/unit/glyph.test.ts`, `mcp/test/unit/theme.test.ts`, `backend/test/lib/errors.test.ts`, `backend/test/lib/embeddings.test.ts`, `frontend/src/lib/components/activity/activity-helpers.test.ts`.

**Integration Tests:**
- `mcp/test/integration/encryption.test.ts` — exercises crypto helpers end-to-end with the real `node:crypto` API.
- `mcp/test/cli/cli-dispatcher.test.ts` — wires the entire CLI handler dispatch table against a real tmpdir-backed event log; no mocks for the production code path.
- `mcp/test/capture/handoff-sync.test.ts` — runs the flush/pull cycle against a `vi.fn`-stubbed `fetch` and a real event log on disk.
- Backend route tests in `backend/test/api/` — every test in `backend/test/api/projects.test.ts`, `conversations.test.ts`, `insights.test.ts`, etc. is integration-style: real Hono router + Miniflare runtime, only Supabase is mocked.

**E2E Tests (`mcp/test/e2e/`):**
- `handoff.e2e.test.ts` — the Tanmai-Monday → Alex-Tuesday two-device handoff test. Boots `stub-backend.ts`, juggles two `SYNAPSE_HOME` tmpdirs, runs the full hook → events.jsonl → flush → pull → brief pipeline, asserts the brief on the receiving device contains the sender's `next_step` text. Single most important test for the v1.1 handoff layer.
- `api-roundtrip.test.ts` — gated by `TEST_E2E=1`; creates a Supabase user via admin API, drives the full user journey (signup, projects, conversations, insights, billing, deletion) against the live `api.synapsesync.app`, then deletes the user. Run with `cd mcp && TEST_E2E=1 npm run test:e2e`.
- `capture-pipeline.test.ts` — exercises the daemon → adapter → store path.
- `cli-status.test.ts`, `cli-dispatch.test.ts` — round-trip CLI shape tests.

**Performance benchmarks (`mcp/test/perf/`):**
- `hook-latency.bench.test.ts` — `PostToolUse` runs 100x in under 5s (avg < 50ms per invocation).
- `init-time.bench.test.ts`, `brief-render.bench.test.ts` — similar shape: tight upper bounds on wall-clock time using `Date.now()` diff + `expect(...).toBeLessThan(...)`.
- Run as ordinary tests via the default Vitest invocation — not gated.

**TDD-leaning workflow:** most v1.1 features land with unit tests, at least one integration test, and an E2E. Reducer (`packages/shared`), CLI dispatcher (`mcp/test/cli/cli-dispatcher.test.ts`), and handoff E2E (`mcp/test/e2e/handoff.e2e.test.ts`) cover the same feature at three levels.

## Common Patterns

**Async testing:**
```ts
it("posts unflushed events and updates watermark", async () => {
  const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
  expect(result.flushed).toBe(2);
});
```
- Always `async` + `await`. Never callback or `.then` chains.
- Promise rejection: `await expect(runInviteCmd({ email: "a@b.c" })).rejects.toThrow(/no project/)` (`mcp/test/cli/invite.test.ts:67`).

**Error path testing:** Wrap in `try/expect.unreachable()/catch` for typed-error assertions when the error class itself matters:
```ts
// frontend/src/lib/server/api.test.ts:113-123
try {
  await api.listProjects();
  expect.unreachable("should have thrown");
} catch (err) {
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(404);
}
```
Or use the simpler `await expect(...).rejects.toThrow(/regex/)` when only the message matters.

**Restore mocks in `afterEach`:** Tests that stub globals always include `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`:
```ts
// frontend/src/lib/server/api.test.ts:34-37
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

**Skip gating with environment flags:** E2E suites use `const suite = RUN ? describe : describe.skip` (see `mcp/test/e2e/api-roundtrip.test.ts:22-23`). Lets the file load but skips all tests unless `TEST_E2E=1`.

**Spy on console to suppress noise:** `vi.spyOn(console, "log").mockImplementation(() => {})` in `beforeEach` (frontend `api.test.ts:30-32`) — never silenced globally, always scoped to the file.

---

*Testing analysis: 2026-05-15*
