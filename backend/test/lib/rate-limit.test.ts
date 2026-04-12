import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Rate limiting", () => {
  it("returns rate limit headers on every response", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("decrements remaining count across requests from the same IP", async () => {
    const ip = `rate-test-${Date.now()}`;

    const req1 = new Request("http://localhost/health", {
      headers: { "cf-connecting-ip": ip },
    });
    const ctx1 = createExecutionContext();
    const res1 = await worker.fetch(req1, env, ctx1);
    await waitOnExecutionContext(ctx1);

    const req2 = new Request("http://localhost/health", {
      headers: { "cf-connecting-ip": ip },
    });
    const ctx2 = createExecutionContext();
    const res2 = await worker.fetch(req2, env, ctx2);
    await waitOnExecutionContext(ctx2);

    const remaining1 = Number.parseInt(res1.headers.get("X-RateLimit-Remaining") ?? "0");
    const remaining2 = Number.parseInt(res2.headers.get("X-RateLimit-Remaining") ?? "0");
    expect(remaining2).toBeLessThan(remaining1);
  });
});
