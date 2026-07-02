import type { SupabaseClient } from "@supabase/supabase-js";
import { getMemberRole, getProjectByName } from "../db/queries";
import type { Project } from "../db/types";
import { ForbiddenError, NotFoundError } from "../lib/errors";

// Postgres throws `invalid input syntax for type uuid` (SQLSTATE 22P02) when
// a query receives a non-UUID-formatted string in a uuid column. Without an
// upfront format check we surface that as HTTP 500 instead of 4xx, which:
//   (a) confuses developers — "the server is broken" vs "your input is malformed"
//   (b) leaks differentiation between "bad format" and "no membership"
//       (treating both as 404 = NotFoundError is also strictly safer for
//       security than 400 — doesn't tell an attacker whether the project
//       exists)
// Fix: validate at the entry of every project-id-keyed helper. UUIDv4 shape
// from RFC 4122 §3 — any 8-4-4-4-12 hex string.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedProject {
  project: Project;
  role: string;
}

/**
 * Resolve a project by name and verify the caller is a member.
 * Throws NotFoundError if project doesn't exist or user isn't a member.
 */
export async function resolveProject(
  db: SupabaseClient,
  projectName: string,
  userId: string,
): Promise<ResolvedProject> {
  const project = await getProjectByName(db, projectName, userId);
  if (!project) {
    throw new NotFoundError("Project not found");
  }
  const role = await getMemberRole(db, project.id, userId);
  if (!role) {
    throw new NotFoundError("Project not found");
  }
  return { project, role };
}

/**
 * Resolve project and require at least editor access.
 * Throws ForbiddenError if the caller is a viewer.
 */
export async function resolveProjectEditor(
  db: SupabaseClient,
  projectName: string,
  userId: string,
): Promise<ResolvedProject> {
  const resolved = await resolveProject(db, projectName, userId);
  if (resolved.role === "viewer") {
    throw new ForbiddenError("Viewers cannot modify this project");
  }
  return resolved;
}

/**
 * Resolve project and require owner access.
 * Throws ForbiddenError if the caller is not the owner.
 */
export async function resolveProjectOwner(
  db: SupabaseClient,
  projectName: string,
  userId: string,
): Promise<ResolvedProject> {
  const resolved = await resolveProject(db, projectName, userId);
  if (resolved.role !== "owner") {
    throw new ForbiddenError("Only the project owner can perform this action");
  }
  return resolved;
}

/**
 * Verify member role on a project by ID (not name).
 * Used when you already have the project ID.
 */
export async function requireRole(
  db: SupabaseClient,
  projectId: string,
  userId: string,
  requiredRole?: "owner" | "editor",
): Promise<string> {
  // Reject non-UUID projectIds upfront — see UUID_RE comment above.
  // Same 404 semantics as "no membership" so the failure modes are
  // indistinguishable to the caller (security: no project-existence oracle).
  if (!UUID_RE.test(projectId)) {
    throw new NotFoundError("Project not found");
  }
  const role = await getMemberRole(db, projectId, userId);
  if (!role) {
    throw new NotFoundError("Project not found");
  }
  if (requiredRole === "owner" && role !== "owner") {
    throw new ForbiddenError("Only the project owner can perform this action");
  }
  if (requiredRole === "editor" && role === "viewer") {
    throw new ForbiddenError("Viewers cannot modify this project");
  }
  return role;
}
