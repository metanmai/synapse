import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareLink } from "../types";
import { singleOrNull } from "../query-helpers";

export async function createShareLink(
  db: SupabaseClient,
  projectId: string,
  role: "editor" | "viewer",
  createdBy: string,
  expiresAt?: string
): Promise<ShareLink> {
  const { data, error } = await db
    .from("share_links")
    .insert({
      project_id: projectId,
      role,
      created_by: createdBy,
      expires_at: expiresAt ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ShareLink;
}

export async function listShareLinks(
  db: SupabaseClient,
  projectId: string
): Promise<ShareLink[]> {
  const { data, error } = await db
    .from("share_links")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShareLink[];
}

export async function getShareLinkByToken(
  db: SupabaseClient,
  token: string
): Promise<ShareLink | null> {
  return singleOrNull<ShareLink>(
    await db.from("share_links").select("*").eq("token", token).single()
  );
}

export async function deleteShareLink(
  db: SupabaseClient,
  projectId: string,
  token: string
): Promise<void> {
  const { error } = await db
    .from("share_links")
    .delete()
    .eq("project_id", projectId)
    .eq("token", token);
  if (error) throw error;
}
