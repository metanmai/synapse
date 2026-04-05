import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { resolveProject } from "../middleware/project-auth";
import { syncProjectFromGoogle } from "../sync/from-google";
import { syncProjectToGoogle } from "../sync/to-google";

const sync = new Hono<{ Bindings: Env }>();
sync.use("*", authMiddleware);

sync.post("/:project/to-google", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = c.get("db");
  const { project } = await resolveProject(db, projectName, user.id);

  const result = await syncProjectToGoogle(c.env, project.id);
  return c.json(result);
});

sync.post("/:project/from-google", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = c.get("db");
  const { project } = await resolveProject(db, projectName, user.id);

  const result = await syncProjectFromGoogle(c.env, project.id);
  return c.json(result);
});

export { sync };
