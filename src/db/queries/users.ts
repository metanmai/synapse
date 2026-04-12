import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../types";

export async function findUserByApiKeyHash(
  db: SupabaseClient,
  apiKeyHash: string
): Promise<User | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("api_key_hash", apiKeyHash)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as User;
}

export async function createUser(
  db: SupabaseClient,
  email: string,
  apiKeyHash: string
): Promise<User> {
  const { data, error } = await db
    .from("users")
    .insert({ email, api_key_hash: apiKeyHash })
    .select()
    .single();

  if (error) throw error;
  return data as User;
}

export async function findUserByEmail(
  db: SupabaseClient,
  email: string
): Promise<User | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as User;
}

export async function findUserBySupabaseAuthId(
  db: SupabaseClient,
  supabaseAuthId: string
): Promise<User | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("supabase_auth_id", supabaseAuthId)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as User;
}
