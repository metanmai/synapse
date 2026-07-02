import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

// Phase 2 (IDENT-01, D-02): GET /api/account/me returns the authenticated user's
// canonical UUID + email, used by `synapse init` to bootstrap ~/.synapse/config.json.
//
// These structural tests follow the existing convention (see projects.test.ts:117-119):
// no-auth path returns 401 via authMiddleware; live-DB behavior (200 + body shape)
// is `it.skip`'d because it requires SUPABASE_URL which isn't available in the test
// environment. Live-DB cases are exercised by the CI e2e job (secrets-gated, push-to-main)
// and by manual smoke against dogfood Supabase.

describe("GET /api/account/me — auth enforcement", () => {
  it("GET /api/account/me without auth returns 401", async () => {
    const req = new Request("http://localhost/api/account/me");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
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
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // 401 if auth middleware fires first; 405 if method-not-allowed fires first.
    // Either is acceptable — the contract is "not authenticated → not allowed in".
    expect([401, 405]).toContain(res.status);
  });
});

describe("GET /api/account/me — live-DB contract (skipped in unit env)", () => {
  // RED until Plan 02-02 lands: these cases describe the contract the implementation
  // must satisfy. Verified via the CI e2e job (with TEST_SUPABASE_* secrets) and
  // manual smoke against dogfood Supabase.

  it.skip("returns 200 + {user_id, email} for a valid API key", async () => {
    // Live-DB: requires SUPABASE_URL + a real api_key seeded in test Supabase.
    // Contract:
    //   - status: 200
    //   - JSON body has { user_id: string (UUID), email: string }
    //   - tier field present (free | plus | team) — schema covered by tier field even if null
  });

  it.skip("user_id is public.users.id, NOT auth.users.id", async () => {
    // Live-DB: critical safety contract. Synapse uses public.users for all FK relationships;
    // auth.users.id is Supabase Auth's internal identifier and MUST NOT leak into application data.
    // The /me endpoint resolves api_key → public.users.id via the existing join chain
    // (api_keys.user_id → public.users.id).
  });

  it.skip("returns 401 with an invalid Bearer token", async () => {
    // Live-DB: auth middleware's invalid-token path hits createSupabaseClient which
    // requires SUPABASE_URL. The no-header test above confirms the middleware exists;
    // this case asserts the bad-token rejection specifically.
  });
});
