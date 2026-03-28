import { Hono } from "hono";
import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import { createUser, findUserByEmail } from "../db/queries/users";
import { hashApiKey, authMiddleware } from "../lib/auth";
import { AppError, ConflictError } from "../lib/errors";

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

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);

  const user = await createUser(db, body.email, apiKeyHash);

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey,
  }, 201);
});

// Google OAuth connect flow — requires auth so we know which user to link
auth.get("/google/connect", authMiddleware, async (c) => {
  const user = c.get("user");
  // Pass user ID in state so callback can associate tokens with the user
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

  const tokens = await tokenRes.json() as any;
  if (!tokens.access_token) {
    throw new AppError("Failed to exchange code for tokens", 400, "OAUTH_ERROR");
  }

  // Save tokens to the user record
  const db = createSupabaseClient(c.env);
  const { error } = await db
    .from("users")
    .update({
      google_oauth_tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
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
