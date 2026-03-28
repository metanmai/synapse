import { Hono } from "hono";

import { createSupabaseClient } from "../db/client";
import {
  countApiKeys,
  createApiKey,
  createUser,
  deleteApiKey,
  deleteUser,
  findUserByEmail,
  listApiKeys,
} from "../db/queries";
import { authMiddleware, hashApiKey } from "../lib/auth";
import { AppError, ConflictError } from "../lib/errors";
import { parseBody, schemas } from "../lib/validate";

import type { Env } from "../lib/env";

const CLI_SESSION_TTL = 5 * 60 * 1000; // 5 minutes

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
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("synapse-cli-session"), info: new Uint8Array(0) },
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

auth.post("/signup", async (c) => {
  const body = await parseBody(c, schemas.signup);

  const db = createSupabaseClient(c.env);
  const existing = await findUserByEmail(db, body.email);
  if (existing) {
    throw new ConflictError("User with this email already exists");
  }

  const user = await createUser(db, body.email);

  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "default");

  return c.json(
    {
      id: user.id,
      email: user.email,
      api_key: apiKey,
    },
    201,
  );
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
  const db = createSupabaseClient(c.env);
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

// POST /auth/cli-session — create a CLI auth session after browser login
// Returns an encrypted code containing the API key + PKCE challenge (stateless — no server-side storage)
auth.post("/cli-session", authMiddleware, async (c) => {
  const body = await parseBody(c, schemas.cliSession);
  const user = c.get("user");

  const db = createSupabaseClient(c.env);

  // Delete existing "cli" key and create a fresh one
  const existingKeys = await listApiKeys(db, user.id);
  const existingCliKey = existingKeys.find((k) => k.label === "cli");
  if (existingCliKey) {
    await deleteApiKey(db, existingCliKey.id, user.id);
  }

  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "cli");

  const code = await encryptSession(
    {
      api_key: apiKey,
      email: user.email ?? "",
      code_challenge: body.code_challenge,
      exp: Date.now() + CLI_SESSION_TTL,
    },
    c.env.SUPABASE_SERVICE_KEY,
  );

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

// Google OAuth connect flow — requires auth so we know which user to link
auth.get("/google/connect", authMiddleware, async (c) => {
  const user = c.get("user");
  const redirectUri = new URL("/auth/google/callback", c.req.url).href;
  const state = btoa(JSON.stringify({ userId: user.id }));
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  if (!code) throw new AppError("Missing code parameter", 400, "VALIDATION_ERROR");
  if (!stateParam) throw new AppError("Missing state parameter", 400, "VALIDATION_ERROR");

  const { userId } = JSON.parse(atob(stateParam));
  const redirectUri = new URL("/auth/google/callback", c.req.url).href;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokens.access_token) {
    throw new AppError("Failed to exchange code for tokens", 400, "OAUTH_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const { error } = await db
    .from("users")
    .update({
      google_oauth_tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      },
    })
    .eq("id", userId);

  if (error) throw error;

  return c.json({
    message: "Google account connected successfully.",
    note: "Use set_preference to link a Google Drive folder to your project.",
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

  const db = createSupabaseClient(c.env);

  const keyCount = await countApiKeys(db, user.id);
  if (keyCount >= 10) {
    throw new AppError("API key limit reached (10). Revoke an existing key first.", 400, "KEY_LIMIT");
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
  const db = createSupabaseClient(c.env);
  const keys = await listApiKeys(db, user.id);
  return c.json(keys);
});

// DELETE /api/account/keys/:id — revoke a key
account.delete("/keys/:id", async (c) => {
  const user = c.get("user");
  const keyId = c.req.param("id");
  const db = createSupabaseClient(c.env);

  const deleted = await deleteApiKey(db, keyId, user.id);
  if (!deleted) {
    throw new AppError("API key not found", 404, "NOT_FOUND");
  }

  return c.json({ ok: true });
});

// DELETE /api/account — delete the authenticated user and all their data
account.delete("/", async (c) => {
  const user = c.get("user");
  const db = createSupabaseClient(c.env);
  await deleteUser(db, user.id);
  return c.json({ ok: true });
});
