import { Hono } from "hono";

import { logActivity } from "../db/activity-logger";
import {
  appendMessages,
  createConversation,
  getConversation,
  getConversationContext,
  getMediaForConversation,
  getMessages,
  insertMedia,
  listConversations,
  saveConversationContext,
  updateConversation,
} from "../db/queries";
import { detectAdapter, getAdapter } from "../lib/adapters";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { AppError, ForbiddenError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";
import { getSignedUrl, uploadMedia } from "../lib/storage";
import { requireConversationSync } from "../lib/tier";
import { parseBody, schemas } from "../lib/validate";
import { requireRole } from "../middleware/project-auth";

const conversations = new Hono<{ Bindings: Env }>();
conversations.use("*", authMiddleware);
conversations.use("*", idempotency);

// POST /api/conversations — create a new conversation
conversations.post("/", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const body = await parseBody(c, schemas.createConversation);

  const db = c.get("db");

  // Verify the user is at least an editor on the project
  await requireRole(db, body.project_id, user.id, "editor");

  const conversation = await createConversation(db, {
    project_id: body.project_id,
    user_id: user.id,
    title: body.title ?? null,
    fidelity_mode: body.fidelity_mode,
    system_prompt: body.system_prompt ?? null,
    working_context: body.working_context ?? null,
    metadata: body.metadata ?? null,
  });

  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "conversation_created",
    source: "human",
    metadata: { conversation_id: conversation.id, title: conversation.title },
  });

  return c.json(conversation, 201);
});

// GET /api/conversations — list conversations for a project
conversations.get("/", async (c) => {
  requireConversationSync(c);
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
  requireConversationSync(c);
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
  requireConversationSync(c);
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

  // Fetch messages, context, and media in parallel
  const [messages, context, media] = await Promise.all([
    getMessages(db, conversationId, { fromSequence, limit: msgLimit }),
    getConversationContext(db, conversationId),
    getMediaForConversation(db, conversationId),
  ]);

  return c.json({
    conversation,
    messages,
    context,
    media,
  });
});

// PATCH /api/conversations/:id — update metadata / soft-delete
conversations.patch("/:id", async (c) => {
  requireConversationSync(c);
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

// POST /api/conversations/:id/messages — append messages with optional context
conversations.post("/:id/messages", async (c) => {
  requireConversationSync(c);
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

  return c.json({ messages });
});

// POST /api/conversations/:id/media — upload media via FormData
conversations.post("/:id/media", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const conversationId = c.req.param("id");

  const db = c.get("db");

  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");

  // Only the owner can upload media
  if (existing.user_id !== user.id) {
    throw new ForbiddenError("Only the conversation owner can upload media");
  }

  const formData = await c.req.formData();
  const file = formData.get("file");
  const messageId = formData.get("message_id");
  const mediaType = formData.get("type") as "image" | "file" | "pdf" | "audio" | "video" | null;

  if (!file || !(file instanceof File)) {
    throw new AppError("file is required", 400, "VALIDATION_ERROR");
  }
  if (!messageId || typeof messageId !== "string") {
    throw new AppError("message_id is required", 400, "VALIDATION_ERROR");
  }

  const content = new Uint8Array(await file.arrayBuffer());
  const filename = file.name || "upload";
  const mimeType = file.type || "application/octet-stream";

  // Upload to storage
  const storagePath = await uploadMedia(db, conversationId, messageId, filename, content, mimeType);

  // Insert media record
  const media = await insertMedia(db, {
    message_id: messageId,
    conversation_id: conversationId,
    type: mediaType ?? "file",
    mime_type: mimeType,
    filename,
    size: content.byteLength,
    storage_path: storagePath,
  });

  await logActivity(db, {
    project_id: existing.project_id,
    user_id: user.id,
    action: "media_uploaded",
    source: "human",
    metadata: {
      conversation_id: conversationId,
      media_id: media.id,
      filename,
      size: content.byteLength,
    },
  });

  return c.json(media, 201);
});

// GET /api/conversations/:id/media/:mediaId — get signed download URL
conversations.get("/:id/media/:mediaId", async (c) => {
  requireConversationSync(c);
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const mediaId = c.req.param("mediaId");

  const db = c.get("db");

  const existing = await getConversation(db, conversationId);
  if (!existing) throw new NotFoundError("Conversation not found");

  // Verify the user is a member of the project
  await requireRole(db, existing.project_id, user.id);

  // Find the media record
  const allMedia = await getMediaForConversation(db, conversationId);
  const media = allMedia.find((m) => m.id === mediaId);
  if (!media) throw new NotFoundError("Media not found");

  const signedUrl = await getSignedUrl(db, media.storage_path);

  return c.json({ url: signedUrl, media });
});

// GET /api/conversations/:id/export/:format — export to target format
conversations.get("/:id/export/:format", async (c) => {
  requireConversationSync(c);
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
