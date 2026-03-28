import { Context, Next } from "hono";

import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash, findUserBySupabaseAuthId } from "../db/queries";
import { UnauthorizedError } from "./errors";

import type { Env } from "./env";
import type { User } from "../db/types";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
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
    const { data } = await supabase.auth.getUser(token);
    if (data?.user) {
      user = await findUserBySupabaseAuthId(db, data.user.id);
    }
  }

  // Fall back to API key
  if (!user) {
    const apiKeyHash = await hashApiKey(token);
    user = await findUserByApiKeyHash(db, apiKeyHash);
  }

  if (!user) {
    throw new UnauthorizedError();
  }

  c.set("user", user);
  await next();
}
