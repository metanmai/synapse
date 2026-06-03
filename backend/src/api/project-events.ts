import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { computeNextSince, parseEventsLimit } from "./project-events-pure";

const projectEvents = new Hono<{ Bindings: Env }>();
projectEvents.use("*", authMiddleware);

projectEvents.get("/:id/events", async (c) => {
  const project_id = c.req.param("id");
  const since = c.req.query("since") ?? null;
  const limit = parseEventsLimit(c.req.query("limit"));
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
  return c.json({ events: data, next_since: computeNextSince(data ?? [], since) });
});

export { projectEvents };
