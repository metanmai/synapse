import { describe, it, expect, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";
import worker from "../../src/index";

describe("Error responses include actual error messages", () => {
  it("returns actual error message, not generic 'Internal server error'", async () => {
    // Hit an authenticated endpoint without auth — should return specific message
    const req = new Request("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const body = await res.json() as { error: string; code: string };
    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid or missing API key");
    expect(body.code).toBe("UNAUTHORIZED");
    // Should NOT be the generic message
    expect(body.error).not.toBe("Internal server error");
  });

  it("returns error code in response body", async () => {
    const req = new Request("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    const body = await res.json() as { error: string; code: string };
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("code");
  });

  it("returns JSON error for missing routes", async () => {
    const req = new Request("http://localhost/api/nonexistent");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
  });
});
