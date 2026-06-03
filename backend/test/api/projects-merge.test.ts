import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

// Phase 2 (IDENT-02, D-07): POST /api/projects/:id/merge-into/:target_id lets a
// signed-in user merge a "source" project into a "target" project they also own.
// Atomic SQL RPC (`merge_projects`) moves all handoff_events from source → target,
// recomputes ProjectStatus, deletes source. Wave 0 covers structural auth gating;
// live-DB behavior (owner-check on both, RPC result, activity-log entry) is `.skip`'d
// per the existing convention.

describe("POST /api/projects/:id/merge-into/:target_id — auth enforcement", () => {
  it("POST without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/source-id/merge-into/target-id", {
      method: "POST",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST without auth returns 401 even with a JSON body", async () => {
    // Auth middleware fires before body-parsing — confirm the gate isn't body-shape-dependent.
    const req = new Request("http://localhost/api/projects/source-id/merge-into/target-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST without auth returns 401 even with UUID-shaped path params", async () => {
    // Routing must NOT 200/204 just because the path looks well-formed.
    const req = new Request(
      "http://localhost/api/projects/00000000-0000-0000-0000-000000000001/merge-into/00000000-0000-0000-0000-000000000002",
      { method: "POST" },
    );
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/projects/:id/merge-into/:target_id — live-DB contract (skipped in unit env)", () => {
  // RED until Plan 02-05 lands. Each case describes a contract the implementation must satisfy;
  // verified via CI e2e job + manual UI smoke against dogfood Supabase.

  it.skip("returns 200 + { ok: true, project_id } when user is owner of BOTH source and target", async () => {
    // Live-DB: requires test Supabase with two projects owned by the test user.
    // Contract: status 200, body { ok: true, project_id: <target_id> }.
    // After this completes, source project no longer exists; all source events have
    // canonical_project_id rewritten to target_id; ProjectStatus is recomputed for target.
  });

  it.skip("returns 403 when user is NOT owner of source", async () => {
    // Critical security contract (T-02-01): cross-user merge-leak guard.
    // Live-DB: requires test Supabase with a project the test user does NOT own as source.
  });

  it.skip("returns 403 when user is NOT owner of target", async () => {
    // Critical security contract (T-02-01): cross-user merge-leak guard, both sides.
    // Live-DB: requires test Supabase with a project the test user does NOT own as target.
  });

  it.skip("returns 409 when source === target (self-merge guard)", async () => {
    // Defensive: route must reject self-merge before invoking the RPC (avoids SQL deadlock /
    // empty rewrite).
  });

  it.skip("writes an activity_log entry on successful merge", async () => {
    // Audit contract: every destructive action MUST leave an activity_log row so users
    // can investigate "where did my project go?" after the fact.
  });
});
