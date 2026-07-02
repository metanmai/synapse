import type { SupabaseClient } from "@supabase/supabase-js";
import { DEVICE_LABEL_PREFIX } from "../../lib/constants";
import type { ApiKey, UserRow } from "../types";

export class ApiKeyExpiredError extends Error {
  constructor() {
    super("API key has expired");
    this.name = "ApiKeyExpiredError";
  }
}

export async function findUserByApiKeyHash(
  db: SupabaseClient,
  keyHash: string,
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
  expiresAt?: string | null,
  machineId?: string | null,
): Promise<ApiKey> {
  const { data, error } = await db
    .from("api_keys")
    .insert({
      user_id: userId,
      key_hash: keyHash,
      label,
      expires_at: expiresAt ?? null,
      machine_id: machineId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ApiKey;
}

/**
 * Phase 03-05: lookup an existing CLI device key for (user_id, machine_id).
 * Returns null if this machine hasn't been registered for this user yet.
 *
 * The api_keys.machine_id column has a partial UNIQUE index over
 * (user_id, machine_id) WHERE machine_id IS NOT NULL — see migration 025.
 * That index makes this a cheap O(1) lookup, and guarantees at most one
 * row matches.
 *
 * Used by /auth/cli-session: if a machine_id is provided AND already
 * registered for this user, we DON'T mint a new device-key (which would
 * burn a slot toward the 3-free / 10-plus cap). Instead, we return null
 * here, the caller detects "same machine re-init" and re-issues a fresh
 * exchange code referencing the existing key.
 *
 * NOTE: the existing key's plaintext is NOT stored server-side (we only
 * keep the hash). So "return existing key" actually means "rotate the
 * key for this row" — we update the hash, return the new plaintext. Same
 * row id, same machine_id, same device-cap impact = zero.
 */
export async function findApiKeyByMachineId(
  db: SupabaseClient,
  userId: string,
  machineId: string,
): Promise<{ id: string; label: string } | null> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, label")
    .eq("user_id", userId)
    .eq("machine_id", machineId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[db] findApiKeyByMachineId failed: ${error.message}`);
    return null;
  }
  return data as { id: string; label: string } | null;
}

/**
 * Phase 03-05: rotate an existing device key's hash. Used when re-init
 * from the same machine returns the existing row instead of creating a
 * duplicate — the row id stays, the hash gets a fresh value so the
 * old plaintext (if it leaked) is invalidated.
 */
export async function rotateApiKeyHash(db: SupabaseClient, keyId: string, newKeyHash: string): Promise<void> {
  const { error } = await db
    .from("api_keys")
    .update({ key_hash: newKeyHash, last_used_at: new Date().toISOString() })
    .eq("id", keyId);
  if (error) throw error;
}

export async function listApiKeys(db: SupabaseClient, userId: string): Promise<Omit<ApiKey, "key_hash">[]> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, label, expires_at, last_used_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Omit<ApiKey, "key_hash">[];
}

export async function deleteApiKey(db: SupabaseClient, keyId: string, userId: string): Promise<boolean> {
  const { error, count } = await db.from("api_keys").delete({ count: "exact" }).eq("id", keyId).eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function countApiKeys(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db.from("api_keys").select("*", { count: "exact", head: true }).eq("user_id", userId);

  if (error) throw error;
  return count ?? 0;
}

export async function updateApiKeyLastUsed(db: SupabaseClient, keyId: string): Promise<void> {
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
  // Fire-and-forget — don't throw on error
}

// Count CLI-installed device keys (label like 'cli-%'). Distinct from
// countApiKeys() which counts ALL keys for the global API_KEY_MAX_PER_USER cap.
export async function countCliKeys(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .like("label", `${DEVICE_LABEL_PREFIX}%`);

  if (error) throw error;
  return count ?? 0;
}

// List CLI-installed device keys (label like 'cli-%') with display-friendly fields.
export async function listCliKeys(db: SupabaseClient, userId: string): Promise<Omit<ApiKey, "key_hash">[]> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, label, expires_at, last_used_at, created_at")
    .eq("user_id", userId)
    .like("label", `${DEVICE_LABEL_PREFIX}%`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Omit<ApiKey, "key_hash">[];
}
