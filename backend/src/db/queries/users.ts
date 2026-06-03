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

/** Safely attempt a DB operation, logging errors but not throwing. */
async function safeDelete(label: string, fn: () => PromiseLike<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[deleteUser] Failed to delete ${label}:`, err);
  }
}

/** Delete per-project data for a list of project IDs. */
async function deleteProjectData(db: SupabaseClient, projectIds: string[]): Promise<void> {
  for (const pid of projectIds) {
    // Conversations: media → messages → context → conversations
    const { data: convos } = await db.from("conversations").select("id").eq("project_id", pid);
    const convoIds = (convos ?? []).map((c) => (c as { id: string }).id);
    if (convoIds.length > 0) {
      await safeDelete(`conversation_media (project ${pid})`, () =>
        db.from("conversation_media").delete().in("conversation_id", convoIds),
      );
      await safeDelete(`conversation_messages (project ${pid})`, () =>
        db.from("conversation_messages").delete().in("conversation_id", convoIds),
      );
      await safeDelete(`conversation_context (project ${pid})`, () =>
        db.from("conversation_context").delete().in("conversation_id", convoIds),
      );
      await safeDelete(`conversations (project ${pid})`, () => db.from("conversations").delete().in("id", convoIds));
    }

    // Entries: history → entries
    const { data: entries } = await db.from("entries").select("id").eq("project_id", pid);
    const entryIds = (entries ?? []).map((e) => (e as { id: string }).id);
    if (entryIds.length > 0) {
      await safeDelete(`entry_history (project ${pid})`, () =>
        db.from("entry_history").delete().in("entry_id", entryIds),
      );
    }
    await safeDelete(`entries (project ${pid})`, () => db.from("entries").delete().eq("project_id", pid));

    await safeDelete(`insights (project ${pid})`, () => db.from("insights").delete().eq("project_id", pid));
    await safeDelete(`activity_log (project ${pid})`, () => db.from("activity_log").delete().eq("project_id", pid));
    await safeDelete(`share_links (project ${pid})`, () => db.from("share_links").delete().eq("project_id", pid));
    await safeDelete(`project_members (project ${pid})`, () =>
      db.from("project_members").delete().eq("project_id", pid),
    );
    await safeDelete(`user_preferences (project ${pid})`, () =>
      db.from("user_preferences").delete().eq("project_id", pid),
    );
  }
}

/** Delete a user and all their data (cascades via FK constraints or manual cleanup). */
export async function deleteUser(db: SupabaseClient, userId: string): Promise<void> {
  // Look up supabase_auth_id before deleting the public row
  const { data: userRow } = await db.from("users").select("supabase_auth_id").eq("id", userId).single();
  const supabaseAuthId = (userRow as { supabase_auth_id?: string } | null)?.supabase_auth_id;

  // Collect all projects the user is a member of
  const { data: projects } = await db.from("project_members").select("project_id").eq("user_id", userId);
  const projectIds = (projects ?? []).map((p) => (p as { project_id: string }).project_id);

  await deleteProjectData(db, projectIds);

  // Delete owned projects, keys, and the user row — always attempt even if earlier steps failed
  await safeDelete("projects", () => db.from("projects").delete().eq("owner_id", userId));
  await safeDelete("api_keys", () => db.from("api_keys").delete().eq("user_id", userId));
  await safeDelete("subscriptions", () => db.from("subscriptions").delete().eq("user_id", userId));
  await safeDelete("users", () => db.from("users").delete().eq("id", userId));

  // Delete the Supabase auth user so auth.users doesn't accumulate
  if (supabaseAuthId) {
    await safeDelete("auth.users", () => db.auth.admin.deleteUser(supabaseAuthId));
  }
}

/** Reset a user — wipe all data but keep the auth user alive. Returns nothing (caller creates the fresh key). */
export async function resetUser(db: SupabaseClient, userId: string): Promise<void> {
  // Collect all projects the user is a member of
  const { data: projects } = await db.from("project_members").select("project_id").eq("user_id", userId);
  const projectIds = (projects ?? []).map((p) => (p as { project_id: string }).project_id);

  await deleteProjectData(db, projectIds);

  // Delete owned projects and API keys (keep subscriptions, users row, and auth user)
  await safeDelete("projects", () => db.from("projects").delete().eq("owner_id", userId));
  await safeDelete("api_keys", () => db.from("api_keys").delete().eq("user_id", userId));
}
