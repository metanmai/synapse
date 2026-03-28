import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRow, ApiKey } from "../types";

export class ApiKeyExpiredError extends Error {
  constructor() {
    super("API key has expired");
    this.name = "ApiKeyExpiredError";
  }
}

export async function findUserByApiKeyHash(
  db: SupabaseClient,
  keyHash: string
): Promise<{ user: UserRow; apiKeyId: string } | null> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, expires_at, users(*)")
    .eq("key_hash", keyHash)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.users) return null;

  // Check expiry — throw specific error so auth middleware can surface it
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new ApiKeyExpiredError();
  }

  return { user: data.users as unknown as UserRow, apiKeyId: data.id };
}

export async function createApiKey(
  db: SupabaseClient,
  userId: string,
  keyHash: string,
  label: string,
  expiresAt?: string | null
): Promise<ApiKey> {
  const { data, error } = await db
    .from("api_keys")
    .insert({
      user_id: userId,
      key_hash: keyHash,
      label,
      expires_at: expiresAt ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ApiKey;
}

export async function listApiKeys(
  db: SupabaseClient,
  userId: string
): Promise<Omit<ApiKey, "key_hash">[]> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, label, expires_at, last_used_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Omit<ApiKey, "key_hash">[];
}

export async function deleteApiKey(
  db: SupabaseClient,
  keyId: string,
  userId: string
): Promise<boolean> {
  const { error, count } = await db
    .from("api_keys")
    .delete({ count: "exact" })
    .eq("id", keyId)
    .eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function countApiKeys(
  db: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await db
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) throw error;
  return count ?? 0;
}

export async function updateApiKeyLastUsed(
  db: SupabaseClient,
  keyId: string
): Promise<void> {
  await db
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);
  // Fire-and-forget — don't throw on error
}
