import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../types";
import { singleOrNull } from "../query-helpers";

export async function createUser(
  db: SupabaseClient,
  email: string
): Promise<User> {
  const { data, error } = await db
    .from("users")
    .insert({ email })
    .select()
    .single();

  if (error) throw error;
  return data as User;
}

export async function findUserByEmail(
  db: SupabaseClient,
  email: string
): Promise<User | null> {
  return singleOrNull<User>(
    await db.from("users").select("*").eq("email", email).single()
  );
}

export async function findUserBySupabaseAuthId(
  db: SupabaseClient,
  supabaseAuthId: string
): Promise<User | null> {
  return singleOrNull<User>(
    await db.from("users").select("*").eq("supabase_auth_id", supabaseAuthId).single()
  );
}

export async function updateStripeCustomerId(
  db: SupabaseClient,
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const { error } = await db
    .from("users")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", userId);

  if (error) throw error;
}
