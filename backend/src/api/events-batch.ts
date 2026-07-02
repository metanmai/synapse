import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { recomputeProjectStatus } from "../lib/handoff-reducer";

const SKEW_LIMIT_MS = 5 * 60 * 1000;

const eventsBatch = new Hono<{ Bindings: Env }>();
eventsBatch.use("*", authMiddleware);

eventsBatch.post("/batch", async (c) => {
  const body = await c.req.json<{ events: Array<Record<string, unknown>> }>();
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return c.json({ error: "events array required" }, 400);
  }
  const user = c.get("user");
  const db = c.get("db");
  const now = Date.now();
  const adjusted: string[] = [];

  const rows = body.events.map((e) => {
    const eventId = String(e.event_id);
    const occMs = new Date(String(e.occurred_at)).getTime();
    let occurred_at = String(e.occurred_at);
    if (occMs - now > SKEW_LIMIT_MS) {
      adjusted.push(eventId);
      occurred_at = new Date(now).toISOString();
    }
    const actor = e.actor as { kind: string; device_id: string };
    return {
      event_id: eventId,
      project_id: String(e.project_id),
      session_id: String(e.session_id),
      actor_user_id: user.id,
      actor_kind: actor.kind,
      actor_device_id: actor.device_id,
      attached_to: e.attached_to ?? null,
      kind: String(e.kind),
      occurred_at,
      received_at: new Date(now).toISOString(),
      payload: e.payload ?? {},
    };
  });

  const { error, count } = await db
    .from("handoff_events")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;

  const accepted = count ?? rows.length;
  const duplicates = rows.length - accepted;

  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  await Promise.all(projectIds.map((pid) => recomputeProjectStatus(db, pid)));

  return c.json({ accepted, duplicates, adjusted });
});

export { eventsBatch };
