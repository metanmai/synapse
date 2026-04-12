import type { Context, Next } from "hono";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants";
import type { Env } from "./env";
import { AppError } from "./errors";

const requests = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(limit = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const key = c.req.header("Authorization") || c.req.header("cf-connecting-ip") || "anonymous";
    const now = Date.now();

    let entry = requests.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      requests.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      throw new AppError("Too many requests. Please try again later.", 429, "RATE_LIMIT");
    }

    await next();
  };
}
