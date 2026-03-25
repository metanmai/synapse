import { Hono } from "hono";

import { authMiddleware } from "../lib/auth";
import { createSupabaseClient } from "../db/client";
import { createProject, listProjectsForUser, getProjectByName, getMemberRole, addMember, removeMember, findUserByEmail, setPreference, getPreferences, createShareLink, listShareLinks, deleteShareLink, getActivityLog } from "../db/queries";
import { logActivity } from "../db/activity-logger";
import { AppError, NotFoundError, ForbiddenError } from "../lib/errors";

import type { Env } from "../lib/env";

const projects = new Hono<{ Bindings: Env }>();
projects.use("*", authMiddleware);

// POST /api/projects
projects.post("/", async (c) => {
  const user = c.get("user");
  const { name } = await c.req.json();
  if (!name) throw new AppError("name is required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const project = await createProject(db, name, user.id);
  await logActivity(db, {
    project_id: project.id,
    user_id: user.id,
    action: "project_created",
    source: "human",
    metadata: { name: project.name },
  });
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
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "member_added",
    target_email: email,
    source: "human",
    metadata: { role },
  });
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
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "member_removed",
    target_email: email,
    source: "human",
  });
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

// POST /api/projects/:id/share-links
projects.post("/:id/share-links", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const { role, expires_at } = await c.req.json();

  if (!role || !["editor", "viewer"].includes(role)) {
    throw new AppError("role must be 'editor' or 'viewer'", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole || callerRole === "viewer") {
    throw new ForbiddenError("Only owners and editors can create share links");
  }

  const link = await createShareLink(db, projectId, role, user.id, expires_at);
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "share_link_created",
    source: "human",
    metadata: { role, token: link.token },
  });

  return c.json(link, 201);
});

// GET /api/projects/:id/share-links
projects.get("/:id/share-links", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole || callerRole === "viewer") {
    throw new ForbiddenError("Only owners and editors can view share links");
  }

  const links = await listShareLinks(db, projectId);
  return c.json(links);
});

// DELETE /api/projects/:id/share-links/:token
projects.delete("/:id/share-links/:token", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const token = c.req.param("token");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (callerRole !== "owner") {
    throw new ForbiddenError("Only owners can revoke share links");
  }

  await deleteShareLink(db, projectId, token);
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "share_link_revoked",
    source: "human",
    metadata: { token },
  });

  return c.json({ ok: true });
});

// GET /api/projects/:id/activity
projects.get("/:id/activity", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const defaultLimit = (c.env as unknown as Record<string, string>).ACTIVITY_PAGE_LIMIT ?? "50";
  const limit = parseInt(c.req.query("limit") ?? defaultLimit);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole) throw new NotFoundError("Project not found");

  const activity = await getActivityLog(db, projectId, limit, offset);
  return c.json(activity);
});

export { projects };
