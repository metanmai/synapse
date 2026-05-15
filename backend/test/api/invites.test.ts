import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Project invites API — auth enforcement", () => {
  it("POST /api/projects/:id/invites without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/00000000-0000-0000-0000-000000000001/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/invites/:token/accept without auth returns 401", async () => {
    const req = new Request("http://localhost/api/invites/some-token/accept", {
      method: "POST",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("route is registered (not 404) when an Authorization header is present", async () => {
    const req = new Request("http://localhost/api/projects/00000000-0000-0000-0000-000000000001/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  it.skip("returns 400 when email is missing (requires valid auth + DB)", async () => {
    // Live data-path verification.
  });

  it.skip("returns 403 when caller is not a project member (requires valid auth + DB)", async () => {
    // Live data-path verification.
  });

  it.skip("returns 200 with join_url on success (requires valid auth + DB)", async () => {
    // Live data-path verification.
  });
});
