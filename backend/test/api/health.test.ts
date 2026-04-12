import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";

// Import the default export (full worker)
import worker from "../../src/index";

describe("Route smoke tests", () => {
  it("GET /health returns 200", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("POST /auth/signup without body returns 400", async () => {
    const req = new Request("http://localhost/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("GET /api/projects without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects");
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

  it("unknown route returns 404", async () => {
    const req = new Request("http://localhost/nonexistent");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("POST /api/share/invalid-token/join without auth returns 401", async () => {
    const req = new Request("http://localhost/api/share/invalid-token/join", {
      method: "POST",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
