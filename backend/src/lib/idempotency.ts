import type { Context, Next } from "hono";
import type { Env } from "./env";

// In-memory idempotency cache (per-isolate, TTL 24 hours)
const cache = new Map<string, { status: number; body: string; expiresAt: number }>();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function idempotency(c: Context<{ Bindings: Env }>, next: Next) {
  const key = c.req.header("Idempotency-Key");
  if (!key) {
    await next();
    return;
  }

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return new Response(cached.body, {
      status: cached.status,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Replayed": "true",
      },
    });
  }

  await next();

  // Cache the response
  if (c.res) {
    const cloned = c.res.clone();
    const body = await cloned.text();
    cache.set(key, {
      status: cloned.status,
      body,
      expiresAt: Date.now() + CACHE_TTL,
    });
  }
}
