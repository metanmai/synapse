import { Context, Next } from "hono";
import type { Env } from "./env";
import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash } from "../db/queries/users";
import { UnauthorizedError } from "./errors";
import type { User } from "../db/types";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
  }
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { hashApiKey };

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const apiKey = authHeader.slice(7);
  const apiKeyHash = await hashApiKey(apiKey);
  const db = createSupabaseClient(c.env);
  const user = await findUserByApiKeyHash(db, apiKeyHash);

  if (!user) {
    throw new UnauthorizedError();
  }

  c.set("user", user);
  await next();
}
