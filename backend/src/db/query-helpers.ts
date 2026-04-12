import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { PG_NO_ROWS } from "../lib/constants";

/**
 * Handle Supabase single-row query: returns data or null if no rows found.
 * Throws on any other error.
 */
export function singleOrNull<T>(result: PostgrestSingleResponse<T>): T | null {
  if (result.error && result.error.code === PG_NO_ROWS) return null;
  if (result.error) {
    console.error(`[db] Query error: ${result.error.message} (code: ${result.error.code})`);
    throw result.error;
  }
  return result.data as T;
}
