import { Hono } from "hono";
import { createSupabaseClient } from "../db/client";
import { getProjectByName } from "../db/queries/projects";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { NotFoundError } from "../lib/errors";
import { syncProjectFromGoogle } from "../sync/from-google";
import { syncProjectToGoogle } from "../sync/to-google";

const sync = new Hono<{ Bindings: Env }>();
sync.use("*", authMiddleware);

sync.post("/:project/to-google", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const result = await syncProjectToGoogle(c.env, proj.id);
  return c.json(result);
});

sync.post("/:project/from-google", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const result = await syncProjectFromGoogle(c.env, proj.id);
  return c.json(result);
});

export { sync };
