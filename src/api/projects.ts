import { Hono } from "hono";
import type { Env } from "../lib/env";
import { authMiddleware } from "../lib/auth";
import { createSupabaseClient } from "../db/client";
import {
  createProject,
  listProjectsForUser,
  getProjectByName,
  getMemberRole,
  addMember,
  removeMember,
} from "../db/queries/projects";
import { findUserByEmail } from "../db/queries/users";
import { setPreference, getPreferences } from "../db/queries/preferences";
import { AppError, NotFoundError, ForbiddenError } from "../lib/errors";

const projects = new Hono<{ Bindings: Env }>();
projects.use("*", authMiddleware);

// POST /api/projects
projects.post("/", async (c) => {
  const user = c.get("user");
  const { name } = await c.req.json();
  if (!name) throw new AppError("name is required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const project = await createProject(db, name, user.id);
  return c.json(project, 201);
});

// GET /api/projects
projects.get("/", async (c) => {
  const user = c.get("user");
  const db = createSupabaseClient(c.env);
  const list = await listProjectsForUser(db, user.id);
  return c.json(list);
});

// POST /api/projects/:id/members
projects.post("/:id/members", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const { email, role } = await c.req.json();

  if (!email || !role) throw new AppError("email and role are required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (callerRole !== "owner") throw new ForbiddenError("Only project owners can invite members");

  const invitee = await findUserByEmail(db, email);
  if (!invitee) throw new NotFoundError(`No user found with email ${email}`);

  const member = await addMember(db, projectId, invitee.id, role);
  return c.json(member, 201);
});

// DELETE /api/projects/:id/members/:email
projects.delete("/:id/members/:email", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const email = c.req.param("email");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (callerRole !== "owner") throw new ForbiddenError("Only project owners can remove members");

  const target = await findUserByEmail(db, email);
  if (!target) throw new NotFoundError(`No user found with email ${email}`);

  await removeMember(db, projectId, target.id);
  return c.json({ ok: true });
});

// PUT /api/preferences/:project
projects.put("/preferences/:project", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const { key, value } = await c.req.json();

  if (!key || !value) throw new AppError("key and value are required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const prefs = await setPreference(db, user.id, proj.id, key, value);
  return c.json(prefs);
});

export { projects };
