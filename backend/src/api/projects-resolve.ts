import { Hono } from "hono";
import { resolveProjectFromSignals } from "../db/queries/projects";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { parseBody, schemas } from "../lib/validate";

const projectsResolve = new Hono<{ Bindings: Env }>();
projectsResolve.use("*", authMiddleware);

// POST /api/projects/resolve
// Thin wrapper: parse + auth here, tier logic lives in resolveProjectFromSignals
// (db/queries/projects.ts) so it's unit-testable with a mock db. See that
// function for the resolution precedence and the basename-asymmetry rationale.
projectsResolve.post("/resolve", async (c) => {
  const user = c.get("user");
  const signals = await parseBody(c, schemas.resolveProject);
  const db = c.get("db");
  return c.json(await resolveProjectFromSignals(db, user.id, signals));
});

export { projectsResolve };
