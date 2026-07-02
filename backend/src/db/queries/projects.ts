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
    .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: "project_id,user_id" })
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

/**
 * Find an existing project for `userId` keyed by git signals, or create a
 * fresh one and add `userId` as owner. Used by both the events-batch
 * auto-create flow and the conversations capture path so a captured
 * session in /path/to/repo lands in the SAME backend project as the
 * handoff events from that cwd — not in `projects[0]`.
 *
 * Match precedence (mirrors events-batch.ts:91-126):
 *   1. `git_remote_url` exact match — globally unique per the user's clones.
 *   2. Project name (= git_basename) match, restricted to user's memberships.
 *      Opportunistically backfills git_remote_url if the matched row had none.
 *   3. Insert new project with `name = git_basename ?? "untitled"` and add
 *      `userId` as owner.
 *
 * Returns the resolved/created project id.
 */
export async function findOrCreateProjectByGit(
  db: SupabaseClient,
  userId: string,
  opts: { git_remote_url?: string | null; git_basename?: string | null },
): Promise<string> {
  const gitBasename = opts.git_basename ?? "untitled";
  const gitRemoteUrl = opts.git_remote_url ?? null;

  const { data: memberships } = await db.from("project_members").select("project_id").eq("user_id", userId);
  const memberProjectIds = (memberships ?? []).map((m: { project_id: string }) => m.project_id);

  let existingId: string | null = null;

  // Tier 1 — URL match. Same-URL duplicates SHOULDN'T exist (a unique index
  // on (owner_id, git_remote_url) prevents them as of migration 021), but
  // until that constraint lands on every deployment we still pick the
  // most-recently-touched row defensively rather than letting Supabase's
  // .maybeSingle() throw on multi-row matches.
  if (gitRemoteUrl && memberProjectIds.length > 0) {
    const { data } = await db
      .from("projects")
      .select("id")
      .eq("git_remote_url", gitRemoteUrl)
      .in("id", memberProjectIds)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existingId = (data as { id: string } | null)?.id ?? null;
  }

  // Tier 2 — name match. Same-name projects ARE legitimate (two `scratch`
  // repos with different URLs both stored at name="scratch"). .maybeSingle()
  // throws on 2+ matches, which would 500 every sync from the second cwd.
  // Pick the most-recently-touched row so the routing is stable across
  // sessions.
  if (!existingId && memberProjectIds.length > 0) {
    const { data: existing } = await db
      .from("projects")
      .select("id, git_remote_url")
      .eq("name", gitBasename)
      .in("id", memberProjectIds)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const existingRow = existing as { id: string; git_remote_url: string | null } | null;
    existingId = existingRow?.id ?? null;

    if (existingId && gitRemoteUrl && !existingRow?.git_remote_url) {
      await db
        .from("projects")
        .update({ git_remote_url: gitRemoteUrl })
        .eq("id", existingId)
        .is("git_remote_url", null);
    }
  }

  if (existingId) return existingId;

  const { data: created, error: createErr } = await db
    .from("projects")
    .insert({ name: gitBasename, owner_id: userId, git_remote_url: gitRemoteUrl })
    .select("id")
    .single();
  if (createErr) throw createErr;
  const createdId = (created as { id: string }).id;

  const { error: memberErr } = await db
    .from("project_members")
    .insert({ project_id: createdId, user_id: userId, role: "owner" });
  if (memberErr) throw memberErr;

  return createdId;
}

export async function getProjectStats(db: SupabaseClient, projectId: string) {
  const [convResult, insightResult] = await Promise.all([
    db
      .from("conversations")
      .select("id, metadata", { count: "exact", head: false })
      .eq("project_id", projectId)
      .neq("status", "deleted"),
    db.from("insights").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);

  const tools: string[] = [];
  if (convResult.data) {
    const toolSet = new Set<string>();
    for (const c of convResult.data) {
      const agent = (c.metadata as Record<string, unknown>)?.source_agent;
      if (typeof agent === "string") toolSet.add(agent);
    }
    tools.push(...toolSet);
  }

  return {
    conversation_count: convResult.count ?? 0,
    insight_count: insightResult.count ?? 0,
    tools,
  };
}
