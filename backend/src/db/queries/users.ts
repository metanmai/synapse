import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import type { UserRow } from "../types";

export async function createUser(db: SupabaseClient, email: string): Promise<UserRow> {
  const { data, error } = await db.from("users").insert({ email }).select().single();

  if (error) throw error;
  return data as UserRow;
}

export async function findUserByEmail(db: SupabaseClient, email: string): Promise<UserRow | null> {
  return singleOrNull<UserRow>(await db.from("users").select("*").eq("email", email).single());
}

export async function findUserBySupabaseAuthId(db: SupabaseClient, supabaseAuthId: string): Promise<UserRow | null> {
  return singleOrNull<UserRow>(await db.from("users").select("*").eq("supabase_auth_id", supabaseAuthId).single());
}

/** Delete a user and all their data (cascades via FK constraints or manual cleanup). */
export async function deleteUser(db: SupabaseClient, userId: string): Promise<void> {
  // Delete in dependency order: entries → activity → members → share_links → projects → api_keys → subscriptions → user
  const { data: projects } = await db.from("project_members").select("project_id").eq("user_id", userId);
  const projectIds = (projects ?? []).map((p) => (p as { project_id: string }).project_id);

  for (const pid of projectIds) {
    await db
      .from("entry_history")
      .delete()
      .in(
        "entry_id",
        (await db.from("entries").select("id").eq("project_id", pid)).data?.map((e) => (e as { id: string }).id) ?? [],
      );
    await db.from("entries").delete().eq("project_id", pid);
    await db.from("activity_log").delete().eq("project_id", pid);
    await db.from("share_links").delete().eq("project_id", pid);
    await db.from("project_members").delete().eq("project_id", pid);
    await db.from("user_project_preferences").delete().eq("project_id", pid);
  }

  // Delete owned projects
  await db.from("projects").delete().eq("owner_id", userId);
  await db.from("api_keys").delete().eq("user_id", userId);
  await db.from("subscriptions").delete().eq("user_id", userId);
  await db.from("users").delete().eq("id", userId);
}
