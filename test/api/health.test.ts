import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";
import app from "../../src/index";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "mcp-sync" });
  });
});
