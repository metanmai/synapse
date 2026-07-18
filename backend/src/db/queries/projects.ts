import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import type { Project, ProjectMember } from "../types";

export async function createProject(db: SupabaseClient, name: string, ownerId: string): Promise<Project> {
  const { data: project, error } = await db.from("projects").insert({ name, owner_id: ownerId }).select().single();
  if (error) throw error;

  // Add owner as a member
  const { error: memberError } = await db
    .from("project_members")
    .upsert({ project_id: project.id, user_id: ownerId, role: "owner" }, { onConflict: "project_id,user_id" });
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
/**
 * Count the projects this user owns. Used by tier-quota enforcement to gate
 * NEW-project creation paths (POST /api/projects, conversations auto-create,
 * events-batch cwd_<hash> remap, MCP create_project). Doesn't include
 * projects the user is a member of but doesn't own — the quota is owner-
 * scoped, not membership-scoped (shared projects don't count against the
 * inviter's quota).
 */
export async function countOwnedProjects(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (error) throw error;
  return count ?? 0;
}

export async function findOrCreateProjectByGit(
  db: SupabaseClient,
  userId: string,
  opts: { git_remote_url?: string | null; git_basename?: string | null },
  hooks?: {
    /**
     * Called RIGHT BEFORE the Tier 3 INSERT — only when we're about to
     * actually create a project (existing matches skip this entirely).
     * Throw from here to abort the create. Used by quota enforcement so
     * a user at 50 projects can still ACCESS existing ones via this
     * helper but can't materialize new ones via the auto-create path
     * (events-batch, conversations capture, etc.).
     */
    onWillCreate?: () => Promise<void> | void;
  },
): Promise<string> {
  const gitBasename = opts.git_basename ?? "untitled";
  const gitRemoteUrl = opts.git_remote_url ?? null;

  const { data: memberships, error: memErr } = await db
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId);
  if (memErr) console.error("findOrCreateProjectByGit memberships err:", memErr);
  const memberProjectIds = (memberships ?? []).map((m: { project_id: string }) => m.project_id);

  let existingId: string | null = null;

  // Tier 1 — URL match. Same-URL duplicates SHOULDN'T exist (a unique index
  // on (owner_id, git_remote_url) prevents them as of migration 021), but
  // until that constraint lands on every deployment we still pick the
  // most-recently-touched row defensively rather than letting Supabase's
  // .maybeSingle() throw on multi-row matches.
  if (gitRemoteUrl && memberProjectIds.length > 0) {
    const { data, error: t1Err } = await db
      .from("projects")
      .select("id")
      .eq("git_remote_url", gitRemoteUrl)
      .in("id", memberProjectIds)
      .limit(1)
      .maybeSingle();
    if (t1Err) console.error("findOrCreateProjectByGit Tier 1 err:", t1Err);
    existingId = (data as { id: string } | null)?.id ?? null;
  }

  // Tier 2 — name match. Same-name projects ARE legitimate (two `scratch`
  // repos with different URLs both stored at name="scratch"). .maybeSingle()
  // throws on 2+ matches, which would 500 every sync from the second cwd.
  // Pick the most-recently-touched row so the routing is stable across
  // sessions.
  if (!existingId && memberProjectIds.length > 0) {
    const { data: existing, error: t2Err } = await db
      .from("projects")
      .select("id, git_remote_url")
      .eq("name", gitBasename)
      .in("id", memberProjectIds)
      .limit(1)
      .maybeSingle();
    if (t2Err) console.error("findOrCreateProjectByGit Tier 2 err:", t2Err);
    const existingRow = existing as { id: string; git_remote_url: string | null } | null;
    existingId = existingRow?.id ?? null;

    if (existingId && gitRemoteUrl && !existingRow?.git_remote_url) {
      const { error: t2UpdErr } = await db
        .from("projects")
        .update({ git_remote_url: gitRemoteUrl })
        .eq("id", existingId)
        .is("git_remote_url", null);
      if (t2UpdErr) console.error("findOrCreateProjectByGit Tier 2 backfill err:", t2UpdErr);
    }
  }

  // Tier 1b — Unscoped owner fallback. When the memberships SELECT above
  // returns null (RLS, transient DB error, etc.), `memberProjectIds` is
  // empty and Tiers 1+2 short-circuit on their `.length > 0` guards. Without
  // this fallback we'd proceed to Tier 3 INSERT, which (post-migration-021)
  // raises 23505 on every duplicate URL, surfacing as a 500 even though the
  // user IS the owner of an existing matching project. owner_id+url is
  // sufficient to find any project this user could have inserted; for
  // projects shared with the user as editor/viewer, the memberships path
  // above is still the primary — this is a safety net for the OWN case.
  if (!existingId && gitRemoteUrl) {
    const { data: owned, error: t1bErr } = await db
      .from("projects")
      .select("id")
      .eq("owner_id", userId)
      .eq("git_remote_url", gitRemoteUrl)
      .limit(1)
      .maybeSingle();
    if (t1bErr) console.error("findOrCreateProjectByGit Tier 1b err:", t1bErr);
    existingId = (owned as { id: string } | null)?.id ?? null;
  }

  if (existingId) return existingId;

  // Last-mile gate: a quota-bearing caller (events-batch / conversations
  // capture / MCP create_project) plugs in here to refuse the create if the
  // user is at tier limit. Existing matches bypass this entirely. The hook
  // throws AppError on violation — we DON'T catch here so it propagates up
  // to the route handler's normal 403 response.
  if (hooks?.onWillCreate) await hooks.onWillCreate();

  // Tier 3 — INSERT a new project. Vulnerable to a race where two
  // workers both passed Tier 1 with `null` and both reach this INSERT
  // concurrently. Migration 021 adds a unique constraint on
  // (owner_id, git_remote_url); the losing INSERT raises 23505 and we
  // recover by re-running Tier 1, which now sees the winner's row.
  const { data: created, error: createErr } = await db
    .from("projects")
    .insert({ name: gitBasename, owner_id: userId, git_remote_url: gitRemoteUrl })
    .select("id")
    .single();

  if (createErr) {
    const violatedUnique =
      gitRemoteUrl !== null &&
      (createErr as { code?: string }).code === "23505" &&
      typeof (createErr as { message?: string }).message === "string" &&
      ((createErr as { message: string }).message.includes("projects_user_remote_url_uniq_idx") ||
        (createErr as { message: string }).message.toLowerCase().includes("git_remote_url"));

    if (violatedUnique) {
      // The winner's row is now visible. Re-run Tier 1 to fetch it.
      const { data: winner, error: winnerErr } = await db
        .from("projects")
        .select("id")
        .eq("git_remote_url", gitRemoteUrl)
        .in("id", memberProjectIds.length > 0 ? memberProjectIds : [""])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (winnerErr) console.error("findOrCreateProjectByGit recovery winner err:", winnerErr);
      const winnerId = (winner as { id: string } | null)?.id ?? null;
      // memberProjectIds was a snapshot from before the race — the winner
      // may have inserted a project_members row that wasn't in our list.
      // Fall back to an unscoped lookup if the scoped query missed.
      if (!winnerId) {
        const { data: anyOwner, error: anyOwnerErr } = await db
          .from("projects")
          .select("id")
          .eq("owner_id", userId)
          .eq("git_remote_url", gitRemoteUrl)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (anyOwnerErr) console.error("findOrCreateProjectByGit recovery anyOwner err:", anyOwnerErr);
        const anyOwnerId = (anyOwner as { id: string } | null)?.id ?? null;
        if (anyOwnerId) return anyOwnerId;
      } else {
        return winnerId;
      }
    }
    throw createErr;
  }
  const createdId = (created as { id: string }).id;

  const { error: memberErr } = await db
    .from("project_members")
    .upsert({ project_id: createdId, user_id: userId, role: "owner" }, { onConflict: "project_id,user_id" });
  if (memberErr) throw memberErr;

  return createdId;
}

export interface ResolveResult {
  project_id: string | null;
  name: string | null;
  confidence: "high" | "medium" | null;
  signal: string;
}

/**
 * Read-path counterpart to {@link findOrCreateProjectByGit}: given the git
 * signals a daemon collects for a cwd, find the EXISTING project the user can
 * already see. Never creates — a true miss returns `signal: "no_match"` so the
 * SessionStart brief renders without a (wrong) handoff.
 *
 * Tier precedence (highest-confidence first):
 *   1. `git_remote_url` exact match — authoritative. The project row stores the
 *      real remote URL at create time, so this is immune to the basename
 *      asymmetry that breaks Tier 2: the WRITE path names a project after the
 *      *folder* basename (`git rev-parse --show-toplevel`), while the READ path
 *      derives `git_basename` from the *URL*. A renamed clone
 *      (`git clone <url> other-name`) makes them diverge, so Tier 2 silently
 *      misses on a second device even though the project plainly exists.
 *   2. Project name (= read-path git_basename) match.
 *   3. Historical cwd match against captured conversations' working_context.
 *   4. Historical git_origin_url match against captured conversations.
 *
 * Extracted from the POST /api/projects/resolve handler so the tier logic is
 * unit-testable with a mock db (the Workers test env has no SUPABASE_URL, so
 * handler-level db logic can't be exercised through worker.fetch).
 */
export async function resolveProjectFromSignals(
  db: SupabaseClient,
  userId: string,
  signals: { cwd: string; git_origin_url?: string | null; git_basename?: string | null },
): Promise<ResolveResult> {
  const { cwd, git_origin_url, git_basename } = signals;

  // Collaboration-aware: owners are added to project_members on creation,
  // so a single query covers both owned and shared projects.
  const { data: memberRows, error: memberErr } = await db
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId);
  if (memberErr) throw memberErr;
  const accessibleIds = new Set<string>((memberRows ?? []).map((r: { project_id: string }) => r.project_id));

  if (accessibleIds.size === 0) {
    return { project_id: null, name: null, confidence: null, signal: "no_access" };
  }
  const accessibleArray = Array.from(accessibleIds);

  // 1. Project URL match (highest confidence). The project row stores the
  //    actual git_remote_url at create time (events-batch → findOrCreateProjectByGit),
  //    so matching it directly is authoritative and sidesteps the basename
  //    asymmetry described above. migration 021's unique index on
  //    (owner_id, git_remote_url) keeps this unambiguous per owner; .limit(1)
  //    guards the rare shared-across-owners collision from throwing in
  //    .maybeSingle(). NB: the projects table has no updated_at column, so we
  //    do NOT .order() here.
  if (git_origin_url) {
    const { data: byUrl, error: urlErr } = await db
      .from("projects")
      .select("id, name")
      .in("id", accessibleArray)
      .eq("git_remote_url", git_origin_url)
      .limit(1)
      .maybeSingle();
    if (urlErr) throw urlErr;
    if (byUrl) {
      return { project_id: byUrl.id, name: byUrl.name, confidence: "high", signal: "project_url" };
    }
  }

  // 2. Name match
  if (git_basename) {
    const { data: byName, error: nameErr } = await db
      .from("projects")
      .select("id, name")
      .in("id", accessibleArray)
      .eq("name", git_basename)
      .limit(1)
      .maybeSingle();
    if (nameErr) throw nameErr;
    if (byName) {
      return { project_id: byName.id, name: byName.name, confidence: "high", signal: "name" };
    }
  }

  // 3. Historical cwd match
  {
    const { data: byCwd, error: cwdErr } = await db
      .from("conversations")
      .select("project_id, projects!inner(name)")
      .in("project_id", accessibleArray)
      .eq("working_context->>cwd", cwd)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cwdErr) throw cwdErr;
    if (byCwd) {
      const row = byCwd as unknown as { project_id: string; projects: { name: string } };
      return { project_id: row.project_id, name: row.projects.name, confidence: "high", signal: "cwd_history" };
    }
  }

  // 4. Historical git origin match
  if (git_origin_url) {
    const { data: byOrigin, error: originErr } = await db
      .from("conversations")
      .select("project_id, projects!inner(name)")
      .in("project_id", accessibleArray)
      .eq("working_context->>git_origin_url", git_origin_url)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (originErr) throw originErr;
    if (byOrigin) {
      const row = byOrigin as unknown as { project_id: string; projects: { name: string } };
      return { project_id: row.project_id, name: row.projects.name, confidence: "medium", signal: "git_origin" };
    }
  }

  return { project_id: null, name: null, confidence: null, signal: "no_match" };
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
