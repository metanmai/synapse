import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Projects API — auth enforcement", () => {
  it("GET /api/projects without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/projects without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-project" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/projects/:id/members without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@test.com", role: "editor" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE /api/projects/:id/members/:email without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/members/test@test.com", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("PUT /api/preferences/:project without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/preferences/myproject", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "context_loading", value: "full" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/projects/:id/share-links without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/share-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/projects/:id/share-links without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/share-links");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE /api/projects/:id/share-links/:token without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/share-links/abc", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/projects/:id/activity without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/activity");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/projects/:id/export without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/export");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/projects/:id/import without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/import", {
      method: "POST",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

// Note: testing with an invalid Bearer token would hit createSupabaseClient
// which requires SUPABASE_URL — not available in the test env. The no-header
// tests above confirm the auth middleware rejects unauthenticated requests.
