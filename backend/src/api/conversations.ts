import { Hono } from "hono";

import { logActivity } from "../db/activity-logger";
import {
  appendMessages,
  createConversation,
  getConversation,
  getConversationContext,
  getMessages,
  listConversations,
  reassignConversation,
  saveConversationContext,
  updateConversation,
} from "../db/queries";
import { findOrCreateProjectByGit } from "../db/queries/projects";
import { detectAdapter, getAdapter } from "../lib/adapters";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { ForbiddenError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";

import { parseBody, schemas } from "../lib/validate";
import { requireRole } from "../middleware/project-auth";

const conversations = new Hono<{ Bindings: Env }>();
conversations.use("*", authMiddleware);
conversations.use("*", idempotency);

// POST /api/conversations — create a new conversation
//
// project_id is optional. When omitted, working_context.git_remote_url and
// working_context.cwd are used to auto-route to (or create) the right
// per-cwd project for the user, via the same findOrCreateProjectByGit
// helper that /api/events/batch uses. The capture-worker relies on this
// path so that sessions captured in /path/to/repo land in the same backend
// project as that repo's handoff events — not in `projects[0]`.
conversations.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, schemas.createConversation);

  const db = c.get("db");

  let projectId = body.project_id ?? null;

  if (!projectId) {
    const wc = (body.working_context ?? {}) as Record<string, unknown>;
    const gitRemoteUrl = typeof wc.git_origin_url === "string" ? wc.git_origin_url : null;
    // git_basename is derived from the cwd's tail; fall back to the
    // projectPath basename if a separate git_basename field isn't present.
    let gitBasename: string | null = null;
    if (typeof wc.git_basename === "string") gitBasename = wc.git_basename;
    else if (typeof wc.cwd === "string") gitBasename = wc.cwd.split("/").filter(Boolean).pop() ?? null;
    else if (typeof wc.projectPath === "string") gitBasename = wc.projectPath.split("/").filter(Boolean).pop() ?? null;

    projectId = await findOrCreateProjectByGit(db, user.id, {
      git_remote_url: gitRemoteUrl,
      git_basename: gitBasename,
    });
  } else {
    // When the caller supplied a project_id explicitly, enforce membership.
    await requireRole(db, projectId, user.id, "editor");
  }

  const conversation = await createConversation(db, {
    project_id: projectId,
    user_id: user.id,
    title: body.title ?? null,
    fidelity_mode: body.fidelity_mode,
    system_prompt: body.system_prompt ?? null,
    working_context: body.working_context ?? null,
    metadata: body.metadata ?? null,
  });

  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "conversation_created",
    source: "human",
    metadata: { conversation_id: conversation.id, title: conversation.title },
  });

  return c.json(conversation, 201);
});

// GET /api/conversations — list conversations for a project
conversations.get("/", async (c) => {
  const user = c.get("user");
  const projectId = c.req.query("project_id");
  if (!projectId) {
    return c.json({ error: "project_id query parameter is required", code: "VALIDATION_ERROR" }, 400);
  }

  const status = c.req.query("status") as "active" | "archived" | undefined;
  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");
  const limit = limitStr ? Number.parseInt(limitStr) : undefined;
  const offset = offsetStr ? Number.parseInt(offsetStr) : undefined;

  const db = c.get("db");

  // Verify the user is a member of the project
  await requireRole(db, projectId, user.id);

  const result = await listConversations(db, projectId, { status, limit, offset });
  return c.json(result);
});

// IMPORTANT: /import must be defined BEFORE /:id routes so Hono doesn't match "import" as an :id

// POST /api/conversations/import — import from external format
conversations.post("/import", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, schemas.importConversation);

  const db = c.get("db");

  // Verify the user is at least an editor on the project
  await requireRole(db, body.project_id, user.id, "editor");

  // Detect or use specified format
  const format = body.format ?? detectAdapter(body.messages);
  const adapter = getAdapter(format);

  // Convert to canonical messages
  const canonicalMessages = adapter.toCanonical(body.messages);

  // Create the conversation
  const conversation = await createConversation(db, {
    project_id: body.project_id,
    user_id: user.id,
    title: body.title ?? null,
    metadata: { imported_format: format },
  });

  // Append the converted messages
  if (canonicalMessages.length > 0) {
    await appendMessages(
      db,
      conversation.id,
      canonicalMessages.map((msg) => ({
        role: msg.role,
        content: msg.content ?? null,
        tool_interaction: msg.toolInteraction ?? null,
        source_agent: msg.source?.agent ?? format,
        source_model: msg.source?.model ?? null,
        token_count: msg.tokenCount ?? null,
        cost: msg.cost ?? null,
      })),
    );
  }

  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "conversation_imported",
    source: "human",
    metadata: {
      conversation_id: conversation.id,
      format,
      message_count: canonicalMessages.length,
    },
  });

  return c.json(conversation, 201);
});

// GET /api/conversations/:id — get full conversation with messages, context, media
conversations.get("/:id", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");

  const fromSequenceStr = c.req.query("from_sequence");
  const msgLimitStr = c.req.query("msg_limit");
  const fromSequence = fromSequenceStr ? Number.parseInt(fromSequenceStr) : undefined;
  const msgLimit = msgLimitStr ? Number.parseInt(msgLimitStr) : undefined;

  const db = c.get("db");

  const conversation = await getConversation(db, conversationId);
  if (!conversation) throw new NotFoundError("Conversation not found");

  // Verify the user is a member of the project
  await requireRole(db, conversation.project_id, user.id);

  // Fetch messages and context in parallel
  const [messages, context] = await Promise.all([
    getMessages(db, conversationId, { fromSequence, limit: msgLimit }),
    getConversationContext(db, conversationId),
  ]);

  return c.json({
    conversation,
    messages,
    context,
  });
});

// PATCH /api/conversations/:id — update metadata / soft-delete
conversations.patch("/:id", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await parseBody(c, schemas.updateConversation);

  const db = c.get("db");

  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");

  // Only the owner can update
  if (existing.user_id !== user.id) {
    throw new ForbiddenError("Only the conversation owner can update");
  }

  const updated = await updateConversation(db, conversationId, body);

  await logActivity(db, {
    project_id: existing.project_id,
    user_id: user.id,
    action: body.status === "deleted" ? "conversation_deleted" : "conversation_updated",
    source: "human",
    metadata: { conversation_id: conversationId },
  });

  return c.json(updated);
});

// POST /api/conversations/:id/reassign — move a conversation to a different project.
//
// Used by `synapse move <conv> <project>` to fix misrouted captures. Auth
// requires editor-or-higher on BOTH the source and target project — moving
// a conversation TO a project the user doesn't have write access to would
// be a privilege escalation; moving it FROM a project the user can't write
// would silently drop data the source's owner expected.
conversations.post("/:id/reassign", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await parseBody(c, schemas.reassignConversation);

  const db = c.get("db");

  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");

  // Source-project write check: caller must be at least editor.
  await requireRole(db, existing.project_id, user.id, "editor");
  // Target-project write check: same.
  await requireRole(db, body.project_id, user.id, "editor");

  // No-op if already in the target project — return the row as-is so
  // callers can be idempotent without conditional logic.
  if (existing.project_id === body.project_id) {
    return c.json(existing);
  }

  const updated = await reassignConversation(db, conversationId, body.project_id);

  // Log on BOTH projects so each project's activity feed reflects the move.
  await logActivity(db, {
    project_id: existing.project_id,
    user_id: user.id,
    action: "conversation_moved_out",
    source: "human",
    metadata: { conversation_id: conversationId, target_project_id: body.project_id },
  });
  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "conversation_moved_in",
    source: "human",
    metadata: { conversation_id: conversationId, source_project_id: existing.project_id },
  });

  return c.json(updated);
});

// POST /api/conversations/:id/messages — append messages with optional context
conversations.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await parseBody(c, schemas.appendMessages);

  const db = c.get("db");

  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");

  // Only the owner can append messages
  if (existing.user_id !== user.id) {
    throw new ForbiddenError("Only the conversation owner can append messages");
  }

  // Append messages
  const messages = await appendMessages(db, conversationId, body.messages);

  // Save context if provided
  if (body.context && body.context.length > 0) {
    await saveConversationContext(db, conversationId, body.context);
  }

  await logActivity(db, {
    project_id: existing.project_id,
    user_id: user.id,
    action: "messages_appended",
    source: "human",
    metadata: {
      conversation_id: conversationId,
      message_count: messages.length,
      has_context: Boolean(body.context?.length),
    },
  });

  // Poke CompactionScheduler DO to schedule/reset compaction alarm
  try {
    const doId = c.env.COMPACTION_SCHEDULER.idFromName(`conversation-${conversationId}`);
    const stub = c.env.COMPACTION_SCHEDULER.get(doId);
    await stub.fetch(
      new Request("https://do/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }),
    );
  } catch (err) {
    // Non-critical — log but don't fail the request
    console.error(`[conversations] Failed to poke CompactionScheduler for ${conversationId}:`, err);
  }

  return c.json({ messages });
});

// GET /api/conversations/:id/export/:format — export to target format
conversations.get("/:id/export/:format", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const format = c.req.param("format");

  const db = c.get("db");

  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");

  // Verify the user is a member of the project
  await requireRole(db, existing.project_id, user.id);

  // Get all messages
  const messages = await getMessages(db, conversationId);

  // Convert to canonical format, then to target format
  const adapter = getAdapter(format);
  const fidelity = existing.fidelity_mode ?? "summary";

  // Map DB messages to CanonicalMessage format (camelCase)
  const canonicalMessages = messages.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system" | "tool",
    content: msg.content ?? "",
    toolInteraction: msg.tool_interaction ?? undefined,
    source: {
      agent: msg.source_agent,
      model: msg.source_model ?? undefined,
    },
    tokenCount: msg.token_count ?? undefined,
    cost: msg.cost ?? undefined,
    parentMessageId: msg.parent_message_id ?? undefined,
    createdAt: msg.created_at,
  }));

  const exported = adapter.fromCanonical(canonicalMessages, fidelity);

  return c.json({
    conversation_id: conversationId,
    format,
    fidelity,
    title: existing.title,
    data: exported,
  });
});

export { conversations };
