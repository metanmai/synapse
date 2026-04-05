import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import type { Project, ProjectMember } from "../types";

export async function createProject(db: SupabaseClient, name: string, ownerId: string): Promise<Project> {
  const { data: project, error } = await db.from("projects").insert({ name, owner_id: ownerId }).select().single();
  if (error) throw error;

  // Add owner as a member
  const { error: memberError } = await db
    .from("project_members")
    .insert({ project_id: project.id, user_id: ownerId, role: "owner" });
  if (memberError) throw memberError;

  return project as Project;
}

export async function listProjectsForUser(
  db: SupabaseClient,
  userId: string,
): Promise<(Project & { owner_email: string; role: string })[]> {
  const { data, error } = await db
    .from("project_members")
    .select("role, projects(*, users!projects_owner_id_fkey(email))")
    .eq("user_id", userId)
    .order("role", { ascending: true }); // owner first (alphabetically before editor/viewer)

  if (error) throw error;
  if (!data) return [];

  type MemberRow = {
    role: string;
    projects: Project & { users?: { email?: string | null } | null };
  };

  return (data as unknown as MemberRow[]).map((row) => ({
    ...row.projects,
    owner_email: row.projects.users?.email ?? "",
    role: row.role,
  }));
}

export async function getProjectByName(
  db: SupabaseClient,
  nameOrQualified: string,
  userId: string,
): Promise<Project | null> {
  // Check for qualified name format: owner-email~project-name
  if (nameOrQualified.includes("~")) {
    const tildeIdx = nameOrQualified.indexOf("~");
    const ownerEmail = nameOrQualified.slice(0, tildeIdx);
    const name = nameOrQualified.slice(tildeIdx + 1);

    const { data, error } = await db
      .from("projects")
      .select("*, project_members!inner(user_id), users!projects_owner_id_fkey(email)")
      .eq("name", name)
      .eq("users.email", ownerEmail)
      .eq("project_members.user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as Project | null;
  }

  // Unqualified name — try owned project first, then fall back to any membership
  const { data: owned, error: ownedErr } = await db
    .from("projects")
    .select("*, project_members!inner(user_id, role)")
    .eq("name", nameOrQualified)
    .eq("project_members.user_id", userId)
    .eq("project_members.role", "owner")
    .limit(1)
    .maybeSingle();

  if (ownedErr) throw ownedErr;
  if (owned) return owned as Project;

  // Fall back to any project the user is a member of with this name
  const { data: shared, error: sharedErr } = await db
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("name", nameOrQualified)
    .eq("project_members.user_id", userId)
    .limit(1)
    .maybeSingle();

  if (sharedErr) throw sharedErr;
  return shared as Project | null;
}

export async function getMemberRole(db: SupabaseClient, projectId: string, userId: string): Promise<string | null> {
  const result = singleOrNull<{ role: string }>(
    await db.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).single(),
  );
  return result?.role ?? null;
}

export async function addMember(
  db: SupabaseClient,
  projectId: string,
  userId: string,
  role: "editor" | "viewer",
): Promise<ProjectMember> {
  const { data, error } = await db
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId, role })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectMember;
}

export async function countMembers(db: SupabaseClient, projectId: string): Promise<number> {
  const { count, error } = await db
    .from("project_members")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .neq("role", "owner"); // don't count the owner
  if (error) throw error;
  return count ?? 0;
}

export async function updateMemberRole(
  db: SupabaseClient,
  projectId: string,
  userId: string,
  role: "editor" | "viewer",
): Promise<void> {
  const { error } = await db.from("project_members").update({ role }).eq("project_id", projectId).eq("user_id", userId);
  if (error) throw error;
}

export async function removeMember(db: SupabaseClient, projectId: string, userId: string): Promise<void> {
  const { error } = await db.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
  if (error) throw error;
}
