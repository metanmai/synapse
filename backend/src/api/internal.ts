import { Hono } from "hono";
import { reconcileProjects } from "../cron/reconcile-projects";
import type { Env } from "../lib/env";

const internal = new Hono<{ Bindings: Env }>();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// POST /internal/reconcile — token-guarded trigger for the project reconciler
// (used by E2E + manual ops). Mounted outside /api so the /api/* auth wildcard
// doesn't shadow it. Returns 404 when INTERNAL_TRIGGER_TOKEN is unset (feature
// off, no information leak), 401 on token mismatch.
internal.post("/reconcile", async (c) => {
  const token = c.env.INTERNAL_TRIGGER_TOKEN;
  if (!token) return c.notFound();
  const provided = c.req.header("x-synapse-internal-token") ?? "";
  if (!constantTimeEqual(provided, token)) return c.json({ error: "unauthorized" }, 401);
  const summary = await reconcileProjects(c.env);
  return c.json({ ok: true, summary });
});

export { internal };
