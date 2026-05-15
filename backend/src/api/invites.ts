import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";

/** 24 random bytes → 32-char base64url string (web-crypto, runs in Workers). */
function generateInviteToken(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// v1.1 invite flow.
// - POST /api/projects/:id/invites { email } — caller must be a member; mints a
//   7-day token and returns a join URL. (Email delivery deferred post-v1.1.)
// - POST /api/invites/:token/accept — caller redeems a valid token; inserts a
//   project_members row and marks the invite accepted.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JOIN_URL_BASE = "https://synapsesync.app/invite";

interface InviteRow {
  token: string;
  project_id: string;
  invited_by_user_id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
}

const invites = new Hono<{ Bindings: Env }>();
invites.use("*", authMiddleware);

invites.post("/projects/:id/invites", async (c) => {
  const project_id = c.req.param("id");
  let body: { email?: string };
  try {
    body = await c.req.json<{ email?: string }>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return c.json({ error: "email required" }, 400);

  const user = c.get("user");
  const db = c.get("db");

  const { data: membership } = await db
    .from("project_members")
    .select("user_id")
    .eq("project_id", project_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return c.json({ error: "not a project member" }, 403);

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await db.from("project_invites").insert({
    token,
    project_id,
    invited_by_user_id: user.id,
    email,
    expires_at: expiresAt,
  });
  if (error) throw error;

  // Email delivery is deferred to post-v1.1. The CLI prints join_url so the
  // inviter can share it manually.
  return c.json({ token, join_url: `${JOIN_URL_BASE}/${token}`, expires_at: expiresAt });
});

invites.post("/invites/:token/accept", async (c) => {
  const token = c.req.param("token");
  const user = c.get("user");
  const db = c.get("db");

  const { data: invite, error: inviteErr } = await db
    .from("project_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (inviteErr) throw inviteErr;
  if (!invite) return c.json({ error: "invite not found" }, 404);

  const row = invite as InviteRow;
  if (row.accepted_at) return c.json({ error: "already accepted" }, 409);
  if (new Date(row.expires_at).getTime() < Date.now()) return c.json({ error: "expired" }, 410);

  const { error: memberErr } = await db
    .from("project_members")
    .insert({ project_id: row.project_id, user_id: user.id, role: "editor" });
  if (memberErr) throw memberErr;

  const { error: updateErr } = await db
    .from("project_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by_user_id: user.id })
    .eq("token", token);
  if (updateErr) throw updateErr;

  return c.json({ project_id: row.project_id });
});

export { invites };
