import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { idempotency } from "../../src/lib/idempotency";

// Create a minimal Hono app with just the idempotency middleware
function createTestApp() {
  let callCount = 0;
  const app = new Hono();
  // biome-ignore lint/suspicious/noExplicitAny: test helper with simplified types
  app.use("*", idempotency as any);
  app.get("/test", (c) => {
    callCount++;
    return c.json({ count: callCount, time: Date.now() });
  });
  return { app, getCallCount: () => callCount };
}

describe("Idempotency middleware", () => {
  it("passes through normally when no Idempotency-Key header is set", async () => {
    const { app } = createTestApp();
    const res = await app.request("/test");

    expect(res.status).toBe(200);
    expect(res.headers.get("Idempotency-Replayed")).toBeNull();
  });

  it("replays cached response for duplicate Idempotency-Key", async () => {
    const { app, getCallCount } = createTestApp();
    const key = `test-idemp-${Date.now()}`;

    // First request
    const res1 = await app.request("/test", {
      headers: { "Idempotency-Key": key },
    });
    const body1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(getCallCount()).toBe(1);

    // Second request with same key — should replay, NOT call handler again
    const res2 = await app.request("/test", {
      headers: { "Idempotency-Key": key },
    });
    const body2 = await res2.json();

    expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
    expect(body2.count).toBe(body1.count);
    expect(getCallCount()).toBe(1); // Handler was NOT called a second time
  });

  it("treats different Idempotency-Keys as separate requests", async () => {
    const { app, getCallCount } = createTestApp();

    const res1 = await app.request("/test", {
      headers: { "Idempotency-Key": "key-a" },
    });
    const res2 = await app.request("/test", {
      headers: { "Idempotency-Key": "key-b" },
    });

    expect(res1.headers.get("Idempotency-Replayed")).toBeNull();
    expect(res2.headers.get("Idempotency-Replayed")).toBeNull();
    expect(getCallCount()).toBe(2);
  });
});
