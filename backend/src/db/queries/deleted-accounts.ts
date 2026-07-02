import type { SupabaseClient } from "@supabase/supabase-js";

export async function recordDeletedAccount(
  db: SupabaseClient,
  params: {
    email: string;
    had_subscription: boolean;
    subscription_cancelled: boolean;
    deleted_by: "self" | "admin";
  },
): Promise<void> {
  const { error } = await db.from("deleted_accounts").insert(params);
  if (error) {
    console.error("[tombstone] Failed to record deleted account:", error.message);
  }
}
