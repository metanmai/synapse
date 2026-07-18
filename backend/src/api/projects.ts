import { Hono } from "hono";

import { logActivity } from "../db/activity-logger";
import {
  addMember,
  countMembers,
  countOwnedProjects,
  createProject,
  createShareLink,
  deleteShareLink,
  findUserByEmail,
  getActivityLog,
  getProjectStats,
  listProjectsForUser,
  listShareLinks,
  removeMember,
  updateMemberRole,
} from "../db/queries";
import { authMiddleware } from "../lib/auth";
import { DEFAULT_PAGE_LIMIT } from "../lib/constants";
import { ForbiddenError, NotFoundError } from "../lib/errors";
import { recomputeProjectStatus } from "../lib/handoff-reducer";
import { idempotency } from "../lib/idempotency";
import { enforceMemberLimit, enforceProjectQuota, requirePlus } from "../lib/tier";
import { parseBody, schemas } from "../lib/validate";
import { requireRole } from "../middleware/project-auth";

import type { Env } from "../lib/env";

const projects = new Hono<{ Bindings: Env }>();
projects.use("*", authMiddleware);
projects.use("*", idempotency);

// POST /api/projects
projects.post("/", async (c) => {
  const user = c.get("user");
  const { name } = await parseBody(c, schemas.createProject);

  const db = c.get("db");

  // Enforce project quota before creating. Counts OWNED projects only —
  // shared projects (role !== "owner") don't count toward the user's cap.
  // (Bug class from pre-Phase-03: listProjectsForUser.length counted shared
  // memberships too, so an invitee with 50 shared projects + 0 owned would
  // be falsely blocked from creating their first project.)
  const ownedCount = await countOwnedProjects(db, user.id);
  enforceProjectQuota(ownedCount, c);

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
  const db = c.get("db");
  const list = await listProjectsForUser(db, user.id);
  const enriched = await Promise.all(
    list.map(async (p) => {
      const stats = await getProjectStats(db, p.id);
      return { ...p, ...stats };
    }),
  );
  return c.json(enriched);
});

// POST /api/projects/:id/members
projects.post("/:id/members", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const { email, role } = await parseBody(c, schemas.addMember);

  const db = c.get("db");
  await requireRole(db, projectId, user.id, "owner");

  // Enforce member limit based on the project owner's tier
  const memberCount = await countMembers(db, projectId);
  enforceMemberLimit(memberCount, c);

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

// PATCH /api/projects/:id/members/:email
projects.patch("/:id/members/:email", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const email = c.req.param("email");
  const { role } = await parseBody(c, schemas.updateMemberRole);

  const db = c.get("db");
  await requireRole(db, projectId, user.id, "owner");

  const target = await findUserByEmail(db, email);
  if (!target) throw new NotFoundError(`No user found with email ${email}`);

  await updateMemberRole(db, projectId, target.id, role);
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "member_role_changed",
    target_email: email,
    source: "human",
    metadata: { role },
  });
  return c.json({ ok: true });
});

// DELETE /api/projects/:id/members/:email
projects.delete("/:id/members/:email", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const email = c.req.param("email");

  const db = c.get("db");
  await requireRole(db, projectId, user.id, "owner");

  const target = await findUserByEmail(db, email);
  if (!target) throw new NotFoundError(`No user found with email ${email}`);

  // Block owner self-removal. requireRole above already guaranteed the
  // caller is owner; if target == caller, this is the owner trying to
  // remove themselves, which would orphan the project (no owner left,
  // every subsequent owner-gated call 404s). Editors/viewers calling
  // here fail requireRole earlier, so this guard is owner-specific.
  if (target.id === user.id) {
    throw new ForbiddenError(
      "You cannot remove yourself from the project. Transfer ownership first or delete the project entirely.",
    );
  }

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

// POST /api/projects/:id/share-links (Plus only — free tier uses email invites)
projects.post("/:id/share-links", async (c) => {
  requirePlus(c, "Share links");

  const user = c.get("user");
  const projectId = c.req.param("id");
  const { role, expires_at } = await parseBody(c, schemas.createShareLink);

  const db = c.get("db");
  await requireRole(db, projectId, user.id, "editor");

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

  const db = c.get("db");
  await requireRole(db, projectId, user.id, "editor");

  const links = await listShareLinks(db, projectId);
  return c.json(links);
});

// DELETE /api/projects/:id/share-links/:token
projects.delete("/:id/share-links/:token", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const token = c.req.param("token");

  const db = c.get("db");
  await requireRole(db, projectId, user.id, "owner");

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
  const defaultLimit = (c.env as unknown as Record<string, string>).ACTIVITY_PAGE_LIMIT ?? String(DEFAULT_PAGE_LIMIT);
  const limit = Number.parseInt(c.req.query("limit") ?? defaultLimit);
  const offset = Number.parseInt(c.req.query("offset") ?? "0");

  const db = c.get("db");
  await requireRole(db, projectId, user.id);

  const activity = await getActivityLog(db, projectId, limit, offset);
  return c.json(activity);
});

// POST /api/projects/:id/merge-into/:target_id
// Phase 2 (IDENT-02, D-07): manual cross-device link / merge UI. Frontend
// LinkPicker.svelte → SvelteKit linkProject action → this endpoint → SQL
// merge_projects RPC. Owner-check ×2 here is defense-in-depth alongside the
// in-SQL re-check; the RPC is atomic (plpgsql transaction).
projects.post("/:id/merge-into/:target_id", async (c) => {
  const user = c.get("user");
  const sourceId = c.req.param("id");
  const targetId = c.req.param("target_id");
  const db = c.get("db");

  if (sourceId === targetId) {
    return c.json({ error: "Cannot link a project to itself", code: "SELF_LINK_ERROR" }, 409);
  }

  await requireRole(db, sourceId, user.id, "owner");
  await requireRole(db, targetId, user.id, "owner");

  const { error } = await db.rpc("merge_projects", {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_user_id: user.id,
  });
  if (error) {
    console.error("[projects/merge] rpc error:", JSON.stringify(error));
    return c.json({ error: `Merge failed: ${error.message}`, code: "MERGE_ERROR" }, 500);
  }

  await logActivity(db, {
    project_id: targetId,
    user_id: user.id,
    action: "project_merged",
    source: "human",
    metadata: { source_project_id: sourceId },
  });

  await recomputeProjectStatus(db, targetId);

  return c.json({ ok: true, project_id: targetId });
});

// DELETE /api/projects/:id
// Owner-only. Default behavior: refuse if the project still holds
// conversations, handoff sessions, or insights (returns 409 PROJECT_NOT_EMPTY with the
// counts in the body) so the caller can decide whether to migrate the
// data first via /merge-into or accept the loss with ?force=true.
//
// Every child table that references projects.id has ON DELETE CASCADE
// (entries, project_members, user_preferences, share_links, activity_log,
// insights, conversations, project_context, handoff_*, project_invites),
// so a single DELETE drops the whole tree atomically — no manual cleanup
// of child rows needed.
//
// The bug class this closes: post-routing-cleanup, the dashboard accumulated
// 30+ empty `untitled` placeholders and 8+ duplicate test projects that no
// existing route could remove. merge_projects could consolidate, but the
// only path to actually drop an empty project was direct SQL.
projects.delete("/:id", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const force = c.req.query("force") === "true";
  const db = c.get("db");

  await requireRole(db, projectId, user.id, "owner");

  if (!force) {
    const stats = await getProjectStats(db, projectId);
    if (stats.conversation_count > 0 || stats.handoff_session_count > 0 || stats.insight_count > 0) {
      return c.json(
        {
          error: `Project still holds ${stats.conversation_count} synced conversation(s), ${stats.handoff_session_count} handoff session(s), and ${stats.insight_count} insight(s). Merge into another project via POST /merge-into/:target_id, or pass ?force=true to delete anyway.`,
          code: "PROJECT_NOT_EMPTY",
          conversation_count: stats.conversation_count,
          handoff_session_count: stats.handoff_session_count,
          insight_count: stats.insight_count,
        },
        409,
      );
    }
  }

  // Capture name BEFORE the delete so the response can echo it back —
  // useful for CLI/UI to confirm what got removed.
  const { data: projectRow } = await db.from("projects").select("name").eq("id", projectId).single();
  const projectName = (projectRow as { name?: string } | null)?.name ?? null;

  const { error } = await db.from("projects").delete().eq("id", projectId);
  if (error) throw error;

  // No activity log entry — the project (and its activity_log rows) is gone.
  // The caller's own confirmation + the CASCADE itself is the audit trail.

  return c.json({ ok: true, deleted_project_id: projectId, name: projectName });
});

export { projects };
