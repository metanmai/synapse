import type { SupabaseClient } from "@supabase/supabase-js";

export async function logActivity(
  db: SupabaseClient,
  params: {
    project_id: string;
    user_id?: string | null;
    action: string;
    target_path?: string;
    target_email?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.from("activity_log").insert({
    project_id: params.project_id,
    user_id: params.user_id ?? null,
    action: params.action,
    target_path: params.target_path ?? null,
    target_email: params.target_email ?? null,
    source: params.source ?? "human",
    metadata: params.metadata ?? null,
  });
}
