import { Hono } from "hono";

import { createApiKey } from "../db/queries/api-keys";
import { recordDeletedAccount } from "../db/queries/deleted-accounts";
import { getActiveSubscription } from "../db/queries/subscriptions";
import { upsertSubscription } from "../db/queries/subscriptions";
import { hashApiKey } from "../lib/auth";
import { creemRequest } from "../lib/creem";
import type { Env } from "../lib/env";

const admin = new Hono<{ Bindings: Env }>();

// Admin auth middleware — checks ADMIN_SECRET header
admin.use("*", async (c, next) => {
  const secret = c.req.header("X-Admin-Secret");
  const expected = c.env.ADMIN_SECRET;
  if (!expected || !secret || secret !== expected) {
    return c.json({ error: "Unauthorized", code: "ADMIN_UNAUTHORIZED" }, 401);
  }
  await next();
});

// DELETE /api/admin/users/:id — delete a user and all their data
admin.delete("/users/:id", async (c) => {
  const userId = c.req.param("id");
  const db = c.get("db");

  // Look up user info before deletion
  const { data: userRow } = await db.from("users").select("email, supabase_auth_id").eq("id", userId).single();
  if (!userRow) return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);
  const { email, supabase_auth_id: supabaseAuthId } = userRow as { email: string; supabase_auth_id?: string };

  // Cancel active subscription
  const activeSub = await getActiveSubscription(db, userId);
  let subscriptionCancelled = false;
  if (activeSub?.provider_subscription_id) {
    try {
      await creemRequest(c.env, "POST", `/subscriptions/${activeSub.provider_subscription_id}/cancel`);
      subscriptionCancelled = true;
    } catch (err) {
      console.error("[admin/delete] Failed to cancel Creem subscription:", err);
    }
  }

  // Record tombstone
  await recordDeletedAccount(db, {
    email,
    had_subscription: !!activeSub,
    subscription_cancelled: subscriptionCancelled,
    deleted_by: "admin",
  });

  const { error: rpcErr } = await db.rpc("delete_user_data", { p_user_id: userId });
  if (rpcErr) {
    return c.json({ error: `Delete failed: ${rpcErr.message}`, code: "DELETE_ERROR" }, 500);
  }

  console.log(`[admin] Deleted user ${userId}`);

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

// POST /api/admin/users/:id/reset — reset a user's data
admin.post("/users/:id/reset", async (c) => {
  const userId = c.req.param("id");
  const db = c.get("db");

  // Verify user exists
  const { data: userRow } = await db.from("users").select("id").eq("id", userId).single();
  if (!userRow) return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);

  const { error: rpcErr } = await db.rpc("reset_user_data", { p_user_id: userId });
  if (rpcErr) {
    return c.json({ error: `Reset failed: ${rpcErr.message}`, code: "RESET_ERROR" }, 500);
  }

  // Create fresh API key for the user
  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, userId, apiKeyHash, "default");

  console.log(`[admin] Reset user ${userId}`);

  return c.json({ ok: true, api_key: apiKey });
});

// POST /api/admin/users/:id/grant-plus — grant Plus tier to a user
admin.post("/users/:id/grant-plus", async (c) => {
  const userId = c.req.param("id");
  const db = c.get("db");

  const { data: userRow } = await db.from("users").select("id").eq("id", userId).single();
  if (!userRow) return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);

  await upsertSubscription(db, {
    user_id: userId,
    provider: "admin",
    provider_subscription_id: `admin-grant-${userId}`,
    status: "active",
    current_period_end: null,
    cancel_at_period_end: false,
  });

  console.log(`[admin] Granted Plus to user ${userId}`);

  return c.json({ ok: true, tier: "plus" });
});

// POST /api/admin/users/:id/revoke-plus — revoke Plus tier from a user
admin.post("/users/:id/revoke-plus", async (c) => {
  const userId = c.req.param("id");
  const db = c.get("db");

  const { data: userRow } = await db.from("users").select("id").eq("id", userId).single();
  if (!userRow) return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);

  const { error } = await db
    .from("subscriptions")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) return c.json({ error: `Revoke failed: ${error.message}`, code: "REVOKE_ERROR" }, 500);

  console.log(`[admin] Revoked Plus from user ${userId}`);

  return c.json({ ok: true, tier: "free" });
});

export { admin };
