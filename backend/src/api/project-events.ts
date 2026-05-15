import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";

const projectEvents = new Hono<{ Bindings: Env }>();
projectEvents.use("*", authMiddleware);

projectEvents.get("/:id/events", async (c) => {
  const project_id = c.req.param("id");
  const since = c.req.query("since") ?? null;
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "200", 10), 1000);
  const db = c.get("db");
  let q = db
    .from("handoff_events")
    .select("*")
    .eq("project_id", project_id)
    .order("event_id", { ascending: true })
    .limit(limit);
  if (since) q = q.gt("event_id", since);
  const { data, error } = await q;
  if (error) throw error;
  const nextSince = data && data.length > 0 ? data[data.length - 1].event_id : since;
  return c.json({ events: data, next_since: nextSince });
});

export { projectEvents };
