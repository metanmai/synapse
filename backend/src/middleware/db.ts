import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context, Next } from "hono";
import { createSupabaseClient } from "../db/client";
import type { Env } from "../lib/env";

declare module "hono" {
  interface ContextVariableMap {
    db: SupabaseClient;
  }
}

/**
 * Attaches a Supabase client to the Hono context.
 * All downstream handlers use c.get("db") instead of creating their own.
 */
export async function dbMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  c.set("db", createSupabaseClient(c.env));
  await next();
}
