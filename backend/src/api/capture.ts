import { Hono } from "hono";

import { type CaptureHost, HOST_TOOL, isCaptureHost } from "@synapse/shared/capture-hosts.js";
import { scrubSecretValues } from "@synapse/shared/redact.js";
import { appendMessages, createConversation } from "../db/queries";
import { countOwnedProjects, findOrCreateProjectByGit } from "../db/queries/projects";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { AppError } from "../lib/errors";
import { enforceProjectQuota } from "../lib/tier";

const capture = new Hono<{ Bindings: Env }>();

// Bearer-auth'd. A capture-scoped key is allowlisted to THIS path only (the
// fail-closed gate in authMiddleware); a full key also works. Same allowlist +
// scrub contract as the daemon's loopback ingest, so both paths behave alike.
capture.use("*", authMiddleware);

interface RawTurn {
  role?: unknown;
  content?: unknown;
  ts?: unknown;
}

export interface NormalizedCapture {
  host: CaptureHost;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Pure allowlist + scrub for a browser-capture payload. Mirrors the daemon's
 * handleIngest contract: reads ONLY `{host ∈ CAPTURE_HOSTS, messages:[{role,
 * content}]}`, scrubs token-shaped values, drops empties. Every other key in
 * the payload is never read, so it cannot survive. Returns a string `error`
 * (→ 400) rather than throwing, so it's trivially unit-testable.
 */
export function normalizeBrowserCapture(body: unknown): NormalizedCapture | { error: string } {
  const b = (body ?? {}) as { host?: unknown; messages?: unknown };
  if (typeof b.host !== "string" || !isCaptureHost(b.host)) {
    return { error: "Unknown or missing capture host" };
  }
  const rawTurns: RawTurn[] = Array.isArray(b.messages) ? (b.messages as RawTurn[]) : [];
  const messages = rawTurns
    .map((t) => ({
      role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: scrubSecretValues(String(t.content ?? "")),
    }))
    .filter((m) => m.content.length > 0);
  if (messages.length === 0) return { error: "No capturable messages" };
  return { host: b.host, messages };
}

// POST /api/capture/browser
capture.post("/browser", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  const normalized = normalizeBrowserCapture(await c.req.json().catch(() => ({})));
  if ("error" in normalized) throw new AppError(normalized.error, 400, "VALIDATION_ERROR");
  const { host, messages } = normalized;

  // Deterministic per-host project for the MVP (AI semantic grouping of browser
  // chats is a follow-up). Quota only fires when a NEW project is materialized.
  const projectId = await findOrCreateProjectByGit(
    db,
    user.id,
    { git_basename: host },
    { onWillCreate: async () => enforceProjectQuota(await countOwnedProjects(db, user.id), c) },
  );

  const title = messages.find((m) => m.role === "user")?.content.slice(0, 80) ?? `${host} session`;
  const conversation = await createConversation(db, {
    project_id: projectId,
    user_id: user.id,
    title,
    working_context: { source: "browser-extension", host },
    metadata: { source: "browser", tool: HOST_TOOL[host] },
  });

  await appendMessages(
    db,
    conversation.id,
    messages.map((m) => ({ role: m.role, content: m.content, source_agent: HOST_TOOL[host] })),
  );

  return c.json({ ok: true, conversation_id: conversation.id });
});

export { capture };
