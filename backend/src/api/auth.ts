import { Hono } from "hono";

import { createSupabaseClient } from "../db/client";
import { createUser, findUserByEmail, createApiKey, listApiKeys, deleteApiKey, countApiKeys } from "../db/queries";
import { hashApiKey, authMiddleware } from "../lib/auth";
import { AppError, ConflictError } from "../lib/errors";

import type { Env } from "../lib/env";

const auth = new Hono<{ Bindings: Env }>();

auth.post("/signup", async (c) => {
  const body = await c.req.json<{ email?: string }>();

  if (!body.email || typeof body.email !== "string") {
    throw new AppError("Email is required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const existing = await findUserByEmail(db, body.email);
  if (existing) {
    throw new ConflictError("User with this email already exists");
  }

  const user = await createUser(db, body.email);

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "default");

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey,
  }, 201);
});

// POST /auth/login — authenticate with email+password, return an API key
auth.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; label?: string }>();

  if (!body.email || !body.password) {
    throw new AppError("email and password are required", 400, "VALIDATION_ERROR");
  }

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

  // Create a new API key for this login
  const keyLabel = body.label || "cli";
  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, keyLabel);

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey,
    label: keyLabel,
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
  const tokens = await tokenRes.json() as GoogleTokenResponse;
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
  const body = await c.req.json<{ label?: string; expires_at?: string | null }>();

  if (!body.label || typeof body.label !== "string" || !body.label.trim()) {
    throw new AppError("label is required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);

  const keyCount = await countApiKeys(db, user.id);
  if (keyCount >= 10) {
    throw new AppError("API key limit reached (10). Revoke an existing key first.", 400, "KEY_LIMIT");
  }

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);

  const created = await createApiKey(db, user.id, apiKeyHash, body.label.trim(), body.expires_at);

  return c.json({
    id: created.id,
    label: created.label,
    api_key: apiKey,
    expires_at: created.expires_at,
    created_at: created.created_at,
  }, 201);
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
