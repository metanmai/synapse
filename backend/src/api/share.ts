import { Hono } from "hono";

import { logActivity } from "../db/activity-logger";
import { addMember, getMemberRole, getShareLinkByToken } from "../db/queries";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { AppError, NotFoundError } from "../lib/errors";

const share = new Hono<{ Bindings: Env }>();

// POST /api/share/:token/join — accept a share link
share.post("/:token/join", authMiddleware, async (c) => {
  const user = c.get("user");
  const token = c.req.param("token") ?? "";

  const db = c.get("db");
  const link = await getShareLinkByToken(db, token);

  if (!link) throw new NotFoundError("Share link not found or expired");

  // Check expiry
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    throw new AppError("Share link has expired", 410, "LINK_EXPIRED");
  }

  // Check if already a member
  const existingRole = await getMemberRole(db, link.project_id, user.id);
  if (existingRole) {
    return c.json({ message: "You are already a member of this project", role: existingRole });
  }

  await addMember(db, link.project_id, user.id, link.role as "editor" | "viewer");
  await logActivity(db, {
    project_id: link.project_id,
    user_id: user.id,
    action: "member_added",
    target_email: user.email,
    source: "human",
    metadata: { via: "share_link", role: link.role },
  });

  return c.json({ message: "Joined project", role: link.role }, 201);
});

export { share };
