import { Context, Next } from "hono";

import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash, findUserBySupabaseAuthId, getActiveSubscription } from "../db/queries";
import { UnauthorizedError } from "./errors";

import type { Env } from "./env";
import type { User } from "../db/types";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    tier: import("../db/types").Tier;
  }
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = authHeader.slice(7);
  const db = createSupabaseClient(c.env);
  let user: User | null = null;

  // Try JWT by verifying with Supabase auth
  if (isJwt(token)) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      console.error("[auth] Supabase getUser failed:", authError.message);
    } else if (data?.user) {
      user = await findUserBySupabaseAuthId(db, data.user.id);
      if (!user) {
        console.error(`[auth] Auth user found (${data.user.id}, ${data.user.email}) but no matching row in public.users. Run the migration or insert manually.`);
      }
    } else {
      console.warn("[auth] JWT provided but Supabase returned no user");
    }
  }

  // Fall back to API key
  if (!user) {
    const apiKeyHash = await hashApiKey(token);
    user = await findUserByApiKeyHash(db, apiKeyHash);
    if (!user && !isJwt(token)) {
      console.warn("[auth] API key provided but no matching user found");
    }
  }

  if (!user) {
    throw new UnauthorizedError();
  }

  c.set("user", user);

  // Resolve tier from subscription status
  const sub = await getActiveSubscription(db, user.id);
  const tier = (sub?.status === "active" || sub?.status === "past_due") ? "pro" : "free";
  c.set("tier", tier);

  await next();
}
