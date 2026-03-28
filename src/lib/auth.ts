import { Context, Next } from "hono";
import type { Env } from "./env";
import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash, findUserBySupabaseAuthId } from "../db/queries/users";
import { UnauthorizedError } from "./errors";
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

async function verifyJwt(
  token: string,
  secret: string
): Promise<{ sub: string } | null> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
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

  // Try JWT first if it looks like one
  if (isJwt(token)) {
    const payload = await verifyJwt(token, c.env.SUPABASE_JWT_SECRET);
    if (payload?.sub) {
      user = await findUserBySupabaseAuthId(db, payload.sub);
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
