import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";

const projectStatus = new Hono<{ Bindings: Env }>();
projectStatus.use("*", authMiddleware);

projectStatus.get("/:id/status", async (c) => {
  const project_id = c.req.param("id");
  const db = c.get("db");
  const { data, error } = await db
    .from("handoff_project_status")
    .select("status")
    .eq("project_id", project_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return c.json({ error: "not found" }, 404);
  return c.json(data.status);
});

export { projectStatus };
