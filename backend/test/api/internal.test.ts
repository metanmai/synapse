import { afterEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

// POST /internal/reconcile is guarded by INTERNAL_TRIGGER_TOKEN: 404 when unset
// (feature off, no leak), 401 on mismatch. The 200 path (actually running the
// reconciler) is covered by e2e-project-correlation.mjs against a real DB.
//
// The cloudflare:test `env` is a shared, writable singleton — mutate it directly
// (passing a copy with the var set to `undefined` does not reliably unset it).
describe("POST /internal/reconcile — token guard", () => {
  afterEach(() => {
    (env as Record<string, unknown>).INTERNAL_TRIGGER_TOKEN = undefined;
  });

  it("returns 404 when INTERNAL_TRIGGER_TOKEN is not configured", async () => {
    (env as Record<string, unknown>).INTERNAL_TRIGGER_TOKEN = undefined;
    const req = new Request("http://localhost/internal/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("returns 401 with a wrong token (proves the route exists + guards)", async () => {
    (env as Record<string, unknown>).INTERNAL_TRIGGER_TOKEN = "right-secret";
    const req = new Request("http://localhost/internal/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-synapse-internal-token": "wrong-secret" },
      body: "{}",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
