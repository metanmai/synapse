import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Session context API — auth enforcement", () => {
  it("GET /api/projects/:id/session-context without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id/session-context");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/workspace/recent-projects without auth returns 401", async () => {
    const req = new Request("http://localhost/api/workspace/recent-projects");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/projects/:id/session-context with invalid bearer is rejected", async () => {
    const req = new Request("http://localhost/api/projects/some-id/session-context", {
      headers: { Authorization: "Bearer bad-token" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect([401, 500]).toContain(res.status);
  });
});
