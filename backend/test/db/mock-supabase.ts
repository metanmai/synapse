import { type Mock, vi } from "vitest";

/**
 * Creates a chainable mock Supabase client that records method calls
 * and returns configurable responses.
 *
 * Every chaining method (select, eq, insert, etc.) returns the same
 * proxy object so callers can verify the full chain. Terminal methods
 * (single, maybeSingle) resolve to `response`.
 *
 * For queries that resolve without a terminal (e.g. `await db.from("x").delete().eq(...)`)
 * the chainable itself is thenable via a custom `.then`.
 */
export function createMockDb(response: { data?: unknown; error?: unknown; count?: number | null } = {}) {
  const chainable: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (v: unknown) => void, reject?: (v: unknown) => void) => void;
  } = {};

  const methods = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "neq",
    "in",
    "is",
    "like",
    "or",
    "overlaps",
    "order",
    "limit",
    "range",
    "textSearch",
  ];

  for (const method of methods) {
    chainable[method] = vi.fn().mockReturnValue(chainable);
  }

  // Terminal methods resolve to the response
  chainable.single = vi.fn().mockResolvedValue(response);
  chainable.maybeSingle = vi.fn().mockResolvedValue(response);

  // Make the chainable itself thenable for non-terminal awaits
  // (e.g. `await db.from("entries").delete().eq(...)`)
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Supabase query chains
  chainable.then = (resolve: (v: unknown) => void, _reject?: (v: unknown) => void) => resolve(response);

  const from = vi.fn().mockReturnValue(chainable);
  const rpc = vi.fn().mockResolvedValue(response);

  return { from, rpc, chainable };
}

/**
 * Shorthand: create a mock that returns successful data.
 */
export function mockSuccess(data: unknown, count?: number | null) {
  return createMockDb({ data, error: null, count: count ?? null });
}

/**
 * Shorthand: create a mock that returns an error.
 */
export function mockError(message: string, code = "UNKNOWN") {
  return createMockDb({
    data: null,
    error: { name: "PostgrestError", code, message, details: "", hint: "" },
  });
}

/**
 * Shorthand: create a mock that returns PGRST116 (no rows) for single().
 */
export function mockNoRows() {
  return createMockDb({
    data: null,
    error: { name: "PostgrestError", code: "PGRST116", message: "No rows found", details: "", hint: "" },
  });
}

/**
 * Multi-step mock: each `from()` call returns a fresh chain that resolves to
 * the NEXT configured response (last response repeats once exhausted). Needed
 * for query helpers / handlers that issue several queries in sequence (e.g.
 * lookup-then-insert, lookup-then-rotate) — createMockDb shares one chain and
 * can't express per-call sequencing. `chains[i]` exposes the i-th call's mocks
 * for `.toHaveBeenCalledWith` assertions.
 */
export function createSequentialMockDb(...responses: { data?: unknown; error?: unknown; count?: number | null }[]) {
  let callIndex = 0;
  const chains: ReturnType<typeof createMockDb>["chainable"][] = [];

  const from = vi.fn().mockImplementation(() => {
    const idx = callIndex++;
    const resp = responses[idx] ?? responses[responses.length - 1];

    const chainable: Record<string, Mock> = {};
    const methods = [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "neq",
      "in",
      "is",
      "like",
      "or",
      "overlaps",
      "order",
      "limit",
      "range",
      "textSearch",
    ];
    for (const m of methods) {
      chainable[m] = vi.fn().mockReturnValue(chainable);
    }
    chainable.single = vi.fn().mockResolvedValue(resp);
    chainable.maybeSingle = vi.fn().mockResolvedValue(resp);
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock
    (chainable as Record<string, unknown>).then = (resolve: (v: unknown) => void) => resolve(resp);

    // biome-ignore lint/suspicious/noExplicitAny: structurally compatible Mock chain TS can't prove without a broad cast
    chains.push(chainable as any);
    return chainable;
  });

  return { from, chains };
}
