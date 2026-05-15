import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityLogEntry } from "../types";

export async function getActivityLog(
  db: SupabaseClient,
  projectId: string,
  limit = 50,
  offset = 0,
): Promise<ActivityLogEntry[]> {
  const { data, error } = await db
    .from("activity_log")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as ActivityLogEntry[];
}
