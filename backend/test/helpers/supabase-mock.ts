// Lightweight Supabase-client mock for backend route CONTRACT tests.
//
// Why this exists (the bug class it guards):
//   Without a `SUPABASE_URL` test-env secret, every backend route test
//   used to `it.skip` past the data-path behavior — 26 contracts (200/
//   400/403/404/409 status codes + body shapes) lived as comment-only
//   stubs. A regression in any of them would only surface in production
//   traffic. `fetchMock` from @cloudflare/vitest-pool-workers is NOT
//   exported in 0.13.2 (the version pinned in backend/package.json), so
//   we mock the Supabase client itself via `vi.mock("../../src/db/client")`
//   and `vi.mock("@supabase/supabase-js")` (see installSupabaseMocks).
//
// Usage shape (inside a test file):
//   import { installSupabaseMocks, makeContractTestEnv, makeMockSupabase,
//     seedApiKeyAuth, setMockDb } from "../helpers/supabase-mock";
//   installSupabaseMocks(); // hoisted vi.mock; MUST be called at top of file
//
//   it("contract", async () => {
//     const db = makeMockSupabase();
//     seedApiKeyAuth(db, { id: "user-uuid", email: "tester@e2e.local" });
//     db.tables.project_members.single = () => ({ data: { role: "owner" }, error: null });
//     setMockDb(db);
//     const res = await worker.fetch(
//       new Request("http://localhost/api/...", { headers: bearer("k") }),
//       makeContractTestEnv(),
//       createExecutionContext(),
//     );
//     expect(res.status).toBe(200);
//   });
//
// The mock is intentionally permissive: every undescribed query returns
// `{ data: null, error: null }`. That keeps test setup focused on the rows
// the contract actually depends on, and the route's "row missing" branch
// falls through naturally.

import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { env as cloudflareEnv } from "../setup";

// ─────────────────────────────────────────────────────────────────────────
//  Per-test state
// ─────────────────────────────────────────────────────────────────────────

interface MockState {
  /** The mock DB used for the next worker.fetch call. */
  db: MockSupabase | null;
}

// Module-level state read by the vi.mock factory at call time. Tests
// configure this via setMockDb before invoking worker.fetch.
export const __mockState__: MockState = { db: null };

export function setMockDb(db: MockSupabase): void {
  __mockState__.db = db;
}

export function resetMockState(): void {
  __mockState__.db = null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Env + auth helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Env passed to worker.fetch. Spreads the cloudflare:test env (which carries
 * the wrangler.jsonc vars) and overrides SUPABASE_URL/SERVICE_KEY so
 * `dbMiddleware` actually constructs a (mocked) client — without these it
 * skips construction entirely (see src/middleware/db.ts).
 *
 * Values don't have to be real; our mocked createSupabaseClient ignores them.
 * They just need to be non-empty strings so the gate in dbMiddleware passes.
 */
export function makeContractTestEnv(): Record<string, unknown> {
  return {
    ...cloudflareEnv,
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-service-key",
  };
}

/** Bearer header convenience. Always uses a non-JWT shape so auth takes the
 * API-key path (which is the simplest to mock). */
export function bearer(token = "test-api-key"): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─────────────────────────────────────────────────────────────────────────
//  Mock builder
// ─────────────────────────────────────────────────────────────────────────

export interface TableScenario {
  /** `.maybeSingle()` terminator */
  maybeSingle?: () => unknown;
  /** `.single()` terminator */
  single?: () => unknown;
  /** `.select(*, { count, head })` count value (the "head: true" path) */
  count?: number;
  /** Result of `.insert(...).select().single()` */
  insertSingle?: () => unknown;
  /** Result of `.insert(...)` awaited directly */
  insert?: () => unknown;
  /** Result of `.update(...).eq(...)` awaited directly */
  update?: () => unknown;
  /** Result of `.upsert(...)` awaited directly */
  upsert?: () => unknown;
  /** Result of `.delete().eq(...)` awaited directly */
  delete?: () => unknown;
  /** Result of `.select(...).eq(...)...` awaited directly (no terminator) */
  select?: () => unknown;
}

export interface MockSupabase {
  tables: Record<string, TableScenario>;
  rpc: Record<string, (args: unknown) => unknown>;
  /** Recorded mutating ops, useful for "no write happened" assertions. */
  calls: { table: string; op: string; args?: unknown }[];
  client: SupabaseClient;
}

/**
 * Chainable query builder. Implements only the bits the backend actually
 * uses today (eq/in/order/limit/maybeSingle/single + thenable for the
 * "no terminator" select). The builder is shared across filter calls so
 * `db.from(t).select(...).eq(a, b).eq(c, d).maybeSingle()` works.
 */
function buildBuilder(
  scenario: TableScenario,
  _calls: MockSupabase["calls"],
  _table: string,
  op: "select" | "insert" | "update" | "upsert" | "delete",
  countOpt: number | undefined,
) {
  const builder: Record<string, unknown> = {};

  builder.single = () => {
    if (op === "insert" && scenario.insertSingle) {
      return Promise.resolve(scenario.insertSingle());
    }
    if (scenario.single) return Promise.resolve(scenario.single());
    return Promise.resolve({ data: null, error: null });
  };

  builder.maybeSingle = () => {
    if (scenario.maybeSingle) return Promise.resolve(scenario.maybeSingle());
    return Promise.resolve({ data: null, error: null });
  };

  for (const m of ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "like", "ilike", "order", "limit", "range"]) {
    builder[m] = () => builder;
  }
  // Nested .select() chained after .update()/.insert() for the
  // "insert(...).select().single()" / "update(...).select()" shapes.
  builder.select = () => builder;

  // Awaiting the builder directly (no `.single()`/`.maybeSingle()`) — return
  // the operation's "direct-result" terminator. Distinct from `.maybeSingle`
  // because the data shape is different (array of rows vs. single row).
  //
  // Supabase's PostgrestBuilder IS thenable by design (its source: literally
  // `class PostgrestBuilder<T> implements PromiseLike<T>` in postgrest-js).
  // The noThenProperty rule exists to catch accidental `.then` on plain
  // records — we're intentionally violating it here to MIRROR the real
  // SDK's behavior so `await db.from(t).select(...).eq(...)` resolves
  // exactly like the production code expects.
  // biome-ignore lint/suspicious/noThenProperty: see comment above
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let result: unknown;
    try {
      if (op === "select") {
        if (scenario.select) result = scenario.select();
        else if (countOpt !== undefined) result = { data: null, count: countOpt, error: null };
        else result = { data: [], error: null };
      } else if (op === "insert") {
        result = scenario.insert ? scenario.insert() : { data: null, error: null };
      } else if (op === "update") {
        result = scenario.update ? scenario.update() : { data: null, error: null, count: 0 };
      } else if (op === "upsert") {
        result = scenario.upsert ? scenario.upsert() : { data: null, error: null, count: 0 };
      } else if (op === "delete") {
        result = scenario.delete ? scenario.delete() : { data: null, error: null, count: 0 };
      }
      return Promise.resolve(result).then(resolve, reject);
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
    }
  };

  return builder;
}

/**
 * Build a fresh MockSupabase. Each test should build its own. Mutate
 * `db.tables[t].{single|maybeSingle|count|...}` to configure behavior.
 */
export function makeMockSupabase(): MockSupabase {
  const tables: Record<string, TableScenario> = {};
  const rpc: Record<string, (args: unknown) => unknown> = {};
  const calls: MockSupabase["calls"] = [];

  const from = (table: string) => {
    if (!tables[table]) tables[table] = {};
    const scenario = tables[table];

    return {
      select: (..._args: unknown[]) => {
        const opts = _args[1] as { count?: string; head?: boolean } | undefined;
        const countOpt = opts?.head && scenario.count !== undefined ? scenario.count : undefined;
        return buildBuilder(scenario, calls, table, "select", countOpt);
      },
      insert: (args: unknown) => {
        calls.push({ table, op: "insert", args });
        return buildBuilder(scenario, calls, table, "insert", undefined);
      },
      update: (args: unknown, _opts?: unknown) => {
        calls.push({ table, op: "update", args });
        return buildBuilder(scenario, calls, table, "update", undefined);
      },
      upsert: (args: unknown, _opts?: unknown) => {
        calls.push({ table, op: "upsert", args });
        return buildBuilder(scenario, calls, table, "upsert", undefined);
      },
      delete: (_opts?: unknown) => {
        calls.push({ table, op: "delete" });
        return buildBuilder(scenario, calls, table, "delete", undefined);
      },
    };
  };

  const client = {
    from,
    rpc: (name: string, args: unknown) => {
      calls.push({ table: `rpc:${name}`, op: "rpc", args });
      if (rpc[name]) return Promise.resolve(rpc[name](args));
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) },
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "test" } }),
    },
  } as unknown as SupabaseClient;

  return { tables, rpc, calls, client };
}

/**
 * Wire `api_keys` + `subscriptions` so authMiddleware accepts an arbitrary
 * Bearer token as `user`. Call before setMockDb. Tier is always "free" — if
 * a test needs "plus", override `db.tables.subscriptions.maybeSingle` after.
 */
export function seedApiKeyAuth(db: MockSupabase, user: { id: string; email: string }): void {
  db.tables.api_keys = {
    ...db.tables.api_keys,
    maybeSingle: () => ({
      data: { id: "key-uuid", user_id: user.id, expires_at: null, users: { ...user } },
      error: null,
    }),
  };
  // The api_keys.update().eq() call (updateApiKeyLastUsed) is fire-and-forget
  // — it doesn't need a specific return.
}

// ─────────────────────────────────────────────────────────────────────────
//  vi.mock installer — call ONCE at top of each test file
// ─────────────────────────────────────────────────────────────────────────

/**
 * Install the vi.mock hooks that swap createSupabaseClient + @supabase/supabase-js.
 *
 * vi.mock is hoisted to the TOP of the importing file, before any imports
 * (including the worker bundle). The factory closures read `__mockState__`
 * at call time, so the same mock module is reusable across tests via
 * setMockDb / resetMockState.
 *
 * Must be invoked at the file top (not inside describe/beforeEach) so the
 * hoisting works. vitest expands `vi.mock` AOT.
 */
export function installSupabaseMocks(): void {
  // No-op — actual vi.mock calls live in the consumer test files. They
  // can't be wrapped in a function because hoisting requires literal
  // `vi.mock(...)` syntax at the file's top level.
  //
  // This stub exists so a single import statement at the top of a test
  // file documents the requirement: importing this helper is a contract
  // that says "this test file mocks Supabase via vi.mock at top."
}
