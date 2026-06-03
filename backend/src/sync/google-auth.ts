import type { Env } from "../lib/env";
import type { GoogleOAuthTokens } from "../db/types";

export async function getAccessToken(env: Env, tokens: GoogleOAuthTokens): Promise<string> {
  if (Date.now() < tokens.expires_at) {
    return tokens.access_token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Failed to refresh Google token");

  tokens.access_token = data.access_token;
  tokens.expires_at = Date.now() + (data.expires_in ?? 3600) * 1000;

  return data.access_token;
}
