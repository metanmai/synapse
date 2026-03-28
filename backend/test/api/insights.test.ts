import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Insights API — auth enforcement", () => {
  it("GET /api/insights without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights?project_id=some-id");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/insights without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: "00000000-0000-0000-0000-000000000000",
        type: "decision",
        summary: "Test insight",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("PATCH /api/insights/:id without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Updated insight" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE /api/insights/:id without auth returns 401", async () => {
    const req = new Request("http://localhost/api/insights/some-id", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("Insights API — all endpoints require auth", () => {
  const endpoints: [string, string][] = [
    ["GET", "/api/insights?project_id=test"],
    ["POST", "/api/insights"],
    ["PATCH", "/api/insights/some-id"],
    ["DELETE", "/api/insights/some-id"],
  ];

  for (const [method, path] of endpoints) {
    it(`${method} ${path} → 401 without auth`, async () => {
      const req = new Request(`http://localhost${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method !== "GET" ? JSON.stringify({}) : undefined,
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(401);
    });
  }
});
