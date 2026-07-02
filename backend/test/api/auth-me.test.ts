// GET /api/account/me — Phase 2 (IDENT-01, D-02). Returns the
// authenticated user's canonical UUID + email + tier, used by
// `synapse init` to bootstrap ~/.synapse/config.json.
//
// Auth-enforcement tests (401 with no token, 401/405 on POST) sit
// alongside the data-path contracts. The data-path contracts are
// implemented as real route invocations against a mocked Supabase
// client (see test/helpers/supabase-mock.ts). The single contract that
// genuinely needs a live Postgres roundtrip — "user_id is public.users.id,
// NOT auth.users.id" — lives in the e2e job at
// mcp/test/e2e/backend-contracts.test.ts because mocking the join chain
// here would prove only that the mock is consistent, not that the FK
// schema is.

import { vi } from "vitest";
import { __mockState__ } from "../helpers/supabase-mock";

// vi.mock MUST be at the top of the file — vitest hoists it before any
// imports execute. The factory closure reads __mockState__ at call time
// so a single mocked module can be reconfigured between tests.
vi.mock("../../src/db/client", () => ({
  createSupabaseClient: () => __mockState__.db?.client,
}));

import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import {
  bearer,
  makeContractTestEnv,
  makeMockSupabase,
  resetMockState,
  seedApiKeyAuth,
  setMockDb,
} from "../helpers/supabase-mock";
import { createExecutionContext, waitOnExecutionContext } from "../setup";

describe("GET /api/account/me — auth enforcement", () => {
  it("GET /api/account/me without auth returns 401", async () => {
    const req = new Request("http://localhost/api/account/me");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/account/me without auth returns 401 (or 405 if route is GET-only)", async () => {
    // GET-only route shape — confirm auth middleware still rejects POST attempts.
    const req = new Request("http://localhost/api/account/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    // 401 if auth middleware fires first; 405 if method-not-allowed fires first.
    // Either is acceptable — the contract is "not authenticated → not allowed in".
    expect([401, 405]).toContain(res.status);
  });
});

describe("GET /api/account/me — data path (mocked Supabase)", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns 200 + { user_id, email, tier } for a valid API key", async () => {
    // Contract: status 200, body has user_id (UUID), email, tier (free|plus).
    // The shape is exactly what `synapse init` writes to ~/.synapse/config.json.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "00000000-0000-0000-0000-00000000abcd", email: "tester@e2e.local" });
    setMockDb(db);

    const req = new Request("http://localhost/api/account/me", { headers: bearer("valid-key") });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user_id: string; email: string; tier?: string };
    expect(body.user_id).toBe("00000000-0000-0000-0000-00000000abcd");
    expect(body.email).toBe("tester@e2e.local");
    // Tier comes from the subscriptions table; seedApiKeyAuth's "no active sub"
    // → "free" fallback. The route MUST surface a tier value so the CLI can
    // gate Plus-only behavior client-side.
    expect(body.tier).toBe("free");
  });

  it("returns 401 with an invalid Bearer token (no matching api_keys row)", async () => {
    // Contract: a non-JWT Bearer token that doesn't match any api_keys.key_hash
    // gets rejected by authMiddleware (UnauthorizedError → 401). The shape
    // matters: this MUST NOT 500 (would leak that the DB is reachable) and
    // MUST NOT 404 (would leak route presence to unauthenticated probers).
    const db = makeMockSupabase();
    // Leave api_keys.maybeSingle defaulting to { data: null } → no user found.
    setMockDb(db);

    const req = new Request("http://localhost/api/account/me", { headers: bearer("bogus-key") });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(401);
  });
});

// NOTE: The "user_id is public.users.id, NOT auth.users.id" contract requires
// a real Postgres FK roundtrip — see mcp/test/e2e/backend-contracts.test.ts.
