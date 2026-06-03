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
  // Look up supabase_auth_id before deleting the public row
  const { data: userRow } = await db.from("users").select("supabase_auth_id").eq("id", userId).single();
  const supabaseAuthId = (userRow as { supabase_auth_id?: string } | null)?.supabase_auth_id;

  // Collect all projects the user is a member of
  const { data: projects } = await db.from("project_members").select("project_id").eq("user_id", userId);
  const projectIds = (projects ?? []).map((p) => (p as { project_id: string }).project_id);

  for (const pid of projectIds) {
    // Conversations: media → messages → context → conversations
    const { data: convos } = await db.from("conversations").select("id").eq("project_id", pid);
    const convoIds = (convos ?? []).map((c) => (c as { id: string }).id);
    if (convoIds.length > 0) {
      await db.from("conversation_media").delete().in("conversation_id", convoIds);
      await db.from("conversation_messages").delete().in("conversation_id", convoIds);
      await db.from("conversation_context").delete().in("conversation_id", convoIds);
      await db.from("conversations").delete().in("id", convoIds);
    }

    // Entries: history → entries
    const { data: entries } = await db.from("entries").select("id").eq("project_id", pid);
    const entryIds = (entries ?? []).map((e) => (e as { id: string }).id);
    if (entryIds.length > 0) {
      await db.from("entry_history").delete().in("entry_id", entryIds);
    }
    await db.from("entries").delete().eq("project_id", pid);

    await db.from("insights").delete().eq("project_id", pid);
    await db.from("activity_log").delete().eq("project_id", pid);
    await db.from("share_links").delete().eq("project_id", pid);
    await db.from("project_members").delete().eq("project_id", pid);
    await db.from("user_project_preferences").delete().eq("project_id", pid);
  }

  // Delete owned projects, keys, subscriptions, and the user row
  await db.from("projects").delete().eq("owner_id", userId);
  await db.from("api_keys").delete().eq("user_id", userId);
  await db.from("subscriptions").delete().eq("user_id", userId);
  await db.from("users").delete().eq("id", userId);

  // Delete the Supabase auth user so auth.users doesn't accumulate
  if (supabaseAuthId) {
    await db.auth.admin.deleteUser(supabaseAuthId);
  }
}
