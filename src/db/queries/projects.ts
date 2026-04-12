import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectMember } from "../types";

export async function createProject(
  db: SupabaseClient,
  name: string,
  ownerId: string
): Promise<Project> {
  const { data: project, error } = await db
    .from("projects")
    .insert({ name, owner_id: ownerId })
    .select()
    .single();
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
  userId: string
): Promise<Project[]> {
  const { data, error } = await db
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("project_members.user_id", userId);
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function getProjectByName(
  db: SupabaseClient,
  name: string,
  userId: string
): Promise<Project | null> {
  const { data, error } = await db
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("name", name)
    .eq("project_members.user_id", userId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as Project;
}

export async function getMemberRole(
  db: SupabaseClient,
  projectId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data?.role ?? null;
}

export async function addMember(
  db: SupabaseClient,
  projectId: string,
  userId: string,
  role: "editor" | "viewer"
): Promise<ProjectMember> {
  const { data, error } = await db
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId, role })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectMember;
}

export async function removeMember(
  db: SupabaseClient,
  projectId: string,
  userId: string
): Promise<void> {
  const { error } = await db
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw error;
}
