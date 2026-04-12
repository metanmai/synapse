import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Context API — auth enforcement", () => {
  it("POST /api/context/save without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "test",
        path: "notes/test.md",
        content: "hello",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/context/myproject/search without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/search?q=test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/context/myproject/list without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/list");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/context/myproject/load without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/load");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/context/session-summary without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/session-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "test",
        summary: "test summary",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/context/file without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "test",
        path: "notes/test.md",
        content: "hello",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/context/myproject/history/some/path without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/history/some/path");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/context/myproject/restore without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes/test.md", historyId: "abc" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE /api/context/myproject/some/path without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/some/path", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/context/myproject/some/path without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/some/path");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

// Note: testing with an invalid Bearer token would hit createSupabaseClient
// which requires SUPABASE_URL — not available in the test env. The no-header
// tests above confirm the auth middleware rejects unauthenticated requests.
