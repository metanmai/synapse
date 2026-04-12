import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserPreferences } from "../types";

export async function getPreferences(db: SupabaseClient, userId: string, projectId: string): Promise<UserPreferences> {
  const { data, error } = await db
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .single();

  if (error && error.code === "PGRST116") {
    // Return defaults if no preferences set
    return {
      user_id: userId,
      project_id: projectId,
      auto_capture: "moderate",
      context_loading: "smart",
    };
  }
  if (error) throw error;
  return data as UserPreferences;
}

export async function setPreference(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  key: string,
  value: string,
): Promise<UserPreferences | { google_drive_folder_id: string }> {
  // google_drive_folder_id is stored on the project, not user_preferences
  if (key === "google_drive_folder_id") {
    const { data, error } = await db
      .from("projects")
      .update({ google_drive_folder_id: value })
      .eq("id", projectId)
      .select("google_drive_folder_id")
      .single();
    if (error) throw error;
    return data as { google_drive_folder_id: string };
  }

  const validKeys: Record<string, string[]> = {
    auto_capture: ["aggressive", "moderate", "manual_only"],
    context_loading: ["full", "smart", "on_demand", "summary_only"],
  };

  if (!(key in validKeys)) {
    throw new Error(
      `Invalid preference key: ${key}. Valid keys: ${Object.keys(validKeys).join(", ")}, google_drive_folder_id`,
    );
  }

  if (!validKeys[key].includes(value)) {
    throw new Error(`Invalid value for ${key}: ${value}. Valid values: ${validKeys[key].join(", ")}`);
  }

  const { data, error } = await db
    .from("user_preferences")
    .upsert({ user_id: userId, project_id: projectId, [key]: value }, { onConflict: "user_id,project_id" })
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferences;
}
