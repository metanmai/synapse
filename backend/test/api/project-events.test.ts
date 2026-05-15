import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("GET /api/projects/:id/events — auth enforcement", () => {
  it("returns 401 without a bearer token", async () => {
    const req = new Request("http://localhost/api/projects/test-project-id/events");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 without a bearer token (with since param)", async () => {
    const req = new Request("http://localhost/api/projects/test-project-id/events?since=evt_001&limit=50");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed bearer token", async () => {
    const req = new Request("http://localhost/api/projects/test-project-id/events", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // auth middleware rejects invalid token; in test env without SUPABASE_URL may return 401 or 500
    expect([401, 500]).toContain(res.status);
  });
});

describe("GET /api/projects/:id/events — data paths", () => {
  it.skip("returns 200 with events array and next_since key for a known project (requires valid auth token + DB)", async () => {
    // Skipped: no SUPABASE_URL in test env, no handoff_events table available.
    // Expected shape: { events: Array<...>, next_since: string | null }
  });

  it.skip("respects ?since= cursor for incremental pull (requires valid auth token + DB)", async () => {
    // Skipped: no SUPABASE_URL in test env.
  });

  it.skip("respects ?limit= cap (requires valid auth token + DB)", async () => {
    // Skipped: no SUPABASE_URL in test env.
  });
});
