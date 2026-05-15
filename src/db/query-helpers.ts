import type { PostgrestSingleResponse } from "@supabase/supabase-js";

/**
 * Handle Supabase single-row query: returns data or null if no rows found.
 * Throws on any other error.
 */
export function singleOrNull<T>(result: PostgrestSingleResponse<T>): T | null {
  if (result.error && result.error.code === "PGRST116") return null;
  if (result.error) throw result.error;
  return result.data as T;
}
