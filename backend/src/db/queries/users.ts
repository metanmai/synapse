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
