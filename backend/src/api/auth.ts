import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";

import {
  countApiKeys,
  countCliKeys,
  createApiKey,
  createUser,
  deleteApiKey,
  findApiKeyByMachineId,
  findUserByEmail,
  getActiveSubscription,
  listApiKeys,
  listCliKeys,
  recordDeletedAccount,
  rotateApiKeyHash,
} from "../db/queries";
import { authMiddleware, hashApiKey } from "../lib/auth";
import {
  API_KEY_MAX_PER_USER,
  CLI_SESSION_SALT,
  CLI_SESSION_TTL_MS,
  DEVICE_LABEL_PREFIX,
  DEVICE_LIMIT_FREE,
  DEVICE_LIMIT_PLUS,
  DEVICE_NAME_MAX_LENGTH,
} from "../lib/constants";
import { creemRequest } from "../lib/creem";
import { AppError, ConflictError } from "../lib/errors";
import { parseBody, schemas } from "../lib/validate";

import type { Env } from "../lib/env";

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Stateless encrypted session tokens — no in-memory storage needed across Workers isolates
async function deriveSessionKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(CLI_SESSION_SALT), info: new Uint8Array(0) },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

interface CliSessionPayload {
  api_key: string;
  email: string;
  code_challenge: string;
  exp: number;
}

async function encryptSession(payload: CliSessionPayload, secret: string): Promise<string> {
  const key = await deriveSessionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptSession(code: string, secret: string): Promise<CliSessionPayload | null> {
  try {
    const key = await deriveSessionKey(secret);
    const raw = Uint8Array.from(atob(code), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const ciphertext = raw.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as CliSessionPayload;
  } catch {
    return null;
  }
}

const auth = new Hono<{ Bindings: Env }>();

// POST /auth/signup — step 1: send verification OTP (no API key until verified)
auth.post("/signup", async (c) => {
  const body = await parseBody(c, schemas.signup);

  const db = c.get("db");
  const existing = await findUserByEmail(db, body.email);
  if (existing) {
    throw new ConflictError("User with this email already exists");
  }

  // Send OTP via Supabase Auth (creates Supabase auth user if needed)
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: otpError } = await supabase.auth.signInWithOtp({ email: body.email });
  if (otpError) {
    throw new AppError(`Failed to send verification email: ${otpError.message}`, 500, "EMAIL_ERROR");
  }

  return c.json({ email: body.email, message: "Verification email sent. Check your inbox for the code." }, 200);
});

// POST /auth/verify-email — step 2: verify OTP and create account + API key
auth.post("/verify-email", async (c) => {
  const body = await parseBody(c, schemas.verifyEmail);

  // Verify OTP via Supabase Auth
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Try both OTP types — signInWithOtp sends "magiclink" tokens, but users may also have email OTP
  let authData: { user: { id: string } | null } = { user: null };
  for (const type of ["magiclink", "email"] as const) {
    const result = await supabase.auth.verifyOtp({ email: body.email, token: body.code, type });
    if (!result.error && result.data?.user) {
      authData = result.data;
      break;
    }
  }

  if (!authData.user) {
    throw new AppError("Invalid or expired verification code", 400, "VERIFICATION_FAILED");
  }

  // Create (or find) the user in public.users
  const db = c.get("db");
  let user = await findUserByEmail(db, body.email);
  if (!user) {
    user = await createUser(db, body.email);
  }

  // Link Supabase Auth user if not already linked
  if (!user.supabase_auth_id && authData.user.id) {
    await db.from("users").update({ supabase_auth_id: authData.user.id }).eq("id", user.id);
  }

  // Create API key
  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "default");

  return c.json({ id: user.id, email: user.email, api_key: apiKey }, 201);
});

// POST /auth/login — authenticate with email+password, return an API key
auth.post("/login", async (c) => {
  const body = await parseBody(c, schemas.login);

  // Authenticate via Supabase Auth
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (authError || !authData.user) {
    throw new AppError("Invalid email or password", 401, "AUTH_ERROR");
  }

  // Find the user in our users table
  const db = c.get("db");
  const user = await findUserByEmail(db, body.email);
  if (!user) {
    throw new AppError("User not found. Please sign up first.", 404, "NOT_FOUND");
  }

  // Check if user already has a key with this label
  const keyLabel = body.label;
  const existingKeys = await listApiKeys(db, user.id);
  const existingKey = existingKeys.find((k) => k.label === keyLabel);

  if (existingKey) {
    // Delete the old key with the same label and create a fresh one
    await deleteApiKey(db, existingKey.id, user.id);
  }

  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, keyLabel);

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey,
    label: keyLabel,
  });
});

/**
 * Sanitize a device name into a label-safe segment: lowercase, only [a-z0-9-],
 * collapse repeated dashes, trim leading/trailing dashes, cap at 60 chars.
 * Exported for unit testing.
 */
export function sanitizeDeviceName(input: string | undefined | null): string {
  const raw = (input ?? "").toString().trim();
  if (!raw) return `device-${Date.now().toString(36)}`;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DEVICE_NAME_MAX_LENGTH);
  return cleaned || `device-${Date.now().toString(36)}`;
}

/** Resolve the device limit for a user's tier. Plus = Infinity. */
function deviceLimitForTier(tier: "free" | "plus"): number {
  return tier === "plus" ? DEVICE_LIMIT_PLUS : DEVICE_LIMIT_FREE;
}

/**
 * Strip the cli- prefix from a label for display. Names stored as cli-foo, shown as foo.
 */
function displayName(label: string): string {
  return label.startsWith(DEVICE_LABEL_PREFIX) ? label.slice(DEVICE_LABEL_PREFIX.length) : label;
}

/**
 * Issue a fresh CLI device key for a user. Shared by cli-session and
 * cli-revoke-and-session — both ultimately call this after their own
 * preconditions (limit check / revocation) are satisfied.
 *
 * Phase 03-05: optionally accepts `machineId` (per-machine UUID). When
 * set, it's persisted on the api_keys row so future calls from the same
 * machine can match on (user_id, machine_id) and skip the device-cap
 * check entirely (see /auth/cli-session for the matching path).
 */
async function mintCliSessionCode(args: {
  db: SupabaseClient;
  user: { id: string; email: string | null };
  deviceLabel: string;
  codeChallenge: string;
  secret: string;
  machineId?: string | null;
}): Promise<string> {
  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(args.db, args.user.id, apiKeyHash, args.deviceLabel, null, args.machineId ?? null);

  return encryptSession(
    {
      api_key: apiKey,
      email: args.user.email ?? "",
      code_challenge: args.codeChallenge,
      exp: Date.now() + CLI_SESSION_TTL_MS,
    },
    args.secret,
  );
}

// POST /auth/cli-session — create a CLI auth session after browser login.
// Returns an encrypted code containing the API key + PKCE challenge (stateless — no server-side storage).
// Enforces per-tier device limits (3 free, unlimited Plus). When the limit is hit, returns
// 409 + the list of existing devices so the web /cli-auth page can offer a "revoke and continue" picker.
auth.post("/cli-session", authMiddleware, async (c) => {
  const body = await parseBody(c, schemas.cliSession);
  const user = c.get("user");
  const db = c.get("db");

  // Resolve tier from active subscription (active or past_due = plus)
  const sub = await getActiveSubscription(db, user.id);
  const tier: "free" | "plus" = sub ? "plus" : "free";
  const limit = deviceLimitForTier(tier);

  // Phase 03-05: if the CLI sent a machine_id and we already have a key
  // registered for this (user_id, machine_id), ROTATE that key's hash and
  // return — DO NOT create a new row that would burn a device-cap slot.
  // This makes `synapsesync wizard` idempotent per-machine: re-running
  // it never accidentally pushes the user over their cap.
  if (body.machine_id) {
    const existing = await findApiKeyByMachineId(db, user.id, body.machine_id);
    if (existing) {
      const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      const apiKeyHash = await hashApiKey(apiKey);
      await rotateApiKeyHash(db, existing.id, apiKeyHash);
      const code = await encryptSession(
        {
          api_key: apiKey,
          email: user.email ?? "",
          code_challenge: body.code_challenge,
          exp: Date.now() + CLI_SESSION_TTL_MS,
        },
        c.env.SUPABASE_SERVICE_KEY,
      );
      return c.json({ code, rotated: true });
    }
  }

  // Count existing devices (cli-* labeled keys)
  const deviceCount = await countCliKeys(db, user.id);
  if (deviceCount >= limit) {
    const devices = await listCliKeys(db, user.id);
    return c.json(
      {
        error: "Device limit reached",
        code: "DEVICE_LIMIT_REACHED",
        tier,
        limit,
        devices: devices.map((d) => ({
          id: d.id,
          name: displayName(d.label),
          last_used_at: d.last_used_at,
          created_at: d.created_at,
        })),
      },
      409,
    );
  }

  const deviceLabel = `${DEVICE_LABEL_PREFIX}${sanitizeDeviceName(body.device_name)}`;
  const code = await mintCliSessionCode({
    db,
    user,
    deviceLabel,
    codeChallenge: body.code_challenge,
    secret: c.env.SUPABASE_SERVICE_KEY,
    machineId: body.machine_id ?? null,
  });

  return c.json({ code });
});

// POST /auth/cli-exchange — exchange encrypted code + PKCE verifier for API key (no auth required)
// Stateless: decrypts the code, verifies PKCE, returns the API key. No server-side session lookup.
auth.post("/cli-exchange", async (c) => {
  const body = await parseBody(c, schemas.cliExchange);

  const session = await decryptSession(body.code, c.env.SUPABASE_SERVICE_KEY);
  if (!session) {
    throw new AppError("Invalid or expired code", 404, "NOT_FOUND");
  }

  // Check expiry
  if (Date.now() > session.exp) {
    throw new AppError("Code expired", 404, "NOT_FOUND");
  }

  // PKCE verification
  const challengeFromVerifier = await sha256hex(body.code_verifier);
  if (challengeFromVerifier !== session.code_challenge) {
    throw new AppError("Invalid code verifier", 401, "AUTH_ERROR");
  }

  return c.json({
    api_key: session.api_key,
    email: session.email,
  });
});

export { auth };

// Account routes — mounted at /api/account in index.ts
export const account = new Hono<{ Bindings: Env }>();
account.use("*", authMiddleware);

// POST /api/account/keys — create a new API key
account.post("/keys", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, schemas.createApiKey);

  const db = c.get("db");

  const keyCount = await countApiKeys(db, user.id);
  if (keyCount >= API_KEY_MAX_PER_USER) {
    throw new AppError(
      `API key limit reached (${API_KEY_MAX_PER_USER}). Revoke an existing key first.`,
      400,
      "KEY_LIMIT",
    );
  }

  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);

  const created = await createApiKey(db, user.id, apiKeyHash, body.label, body.expires_at);

  return c.json(
    {
      id: created.id,
      label: created.label,
      api_key: apiKey,
      expires_at: created.expires_at,
      created_at: created.created_at,
    },
    201,
  );
});

// GET /api/account/keys — list all keys
account.get("/keys", async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const keys = await listApiKeys(db, user.id);
  return c.json(keys);
});

// DELETE /api/account/keys/:id — revoke a key
account.delete("/keys/:id", async (c) => {
  const user = c.get("user");
  const keyId = c.req.param("id");
  const db = c.get("db");

  const deleted = await deleteApiKey(db, keyId, user.id);
  if (!deleted) {
    throw new AppError("API key not found", 404, "NOT_FOUND");
  }

  return c.json({ ok: true });
});

// GET /api/account/me — return the authenticated user's canonical identity.
// Used by `synapse init` (Phase 2 D-02) to bootstrap ~/.synapse/config.json
// with the real public.users.id + email instead of the legacy "default" placeholder.
account.get("/me", async (c) => {
  const user = c.get("user");
  const tier = c.get("tier");
  return c.json({ user_id: user.id, email: user.email, tier });
});

// POST /api/account/reset — wipe all user data but keep the auth user alive
account.post("/reset", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  // Single RPC call — avoids Cloudflare Workers subrequest limit
  const { error: rpcErr } = await db.rpc("reset_user_data", { p_user_id: user.id });
  if (rpcErr) {
    console.error("[account/reset] rpc error:", JSON.stringify(rpcErr));
    return c.json({ error: `Reset failed: ${rpcErr.message}`, code: "RESET_ERROR" }, 500);
  }

  // Create a fresh API key (reset_user_data already deleted all keys)
  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "default");

  return c.json({ ok: true, api_key: apiKey });
});

// DELETE /api/account — delete the authenticated user and all their data
account.delete("/", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  // Cancel active Creem subscription before deleting data
  const activeSub = await getActiveSubscription(db, user.id);
  let subscriptionCancelled = false;
  if (activeSub?.provider_subscription_id) {
    try {
      await creemRequest(c.env, "POST", `/subscriptions/${activeSub.provider_subscription_id}/cancel`);
      subscriptionCancelled = true;
    } catch (err) {
      console.error("[account/delete] Failed to cancel Creem subscription:", err);
    }
  }

  // Record tombstone before data is wiped
  await recordDeletedAccount(db, {
    email: user.email,
    had_subscription: !!activeSub,
    subscription_cancelled: subscriptionCancelled,
    deleted_by: "self",
  });

  // Look up supabase_auth_id before deletion
  const { data: userRow } = await db.from("users").select("supabase_auth_id").eq("id", user.id).single();
  const supabaseAuthId = (userRow as { supabase_auth_id?: string } | null)?.supabase_auth_id;

  const { error: rpcErr } = await db.rpc("delete_user_data", { p_user_id: user.id });
  if (rpcErr) {
    return c.json({ error: `Delete failed: ${rpcErr.message}`, code: "DELETE_ERROR" }, 500);
  }

  // Delete from auth.users (can't be done in SQL function)
  if (supabaseAuthId) {
    try {
      await db.auth.admin.deleteUser(supabaseAuthId);
    } catch (_) {
      // best-effort
    }
  }

  return c.json({ ok: true });
});
