import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("save_insight legacy compatibility", () => {
  it("save_insight POST /api/insights remains routable under handoff schema additions", async () => {
    const req = new Request("http://localhost/api/insights", {
      method: "POST",
      headers: { Authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ project: "p", type: "decision", summary: "x", detail: "y" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // Without a real DB, auth will fail (401) or DB-dep handler will surface its error.
    // The point of this test is that the ROUTE is still registered and returns SOMETHING (not 404).
    expect(res.status).not.toBe(404);
  });
});
