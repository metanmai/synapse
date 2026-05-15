import { Hono } from "hono";
import { getConversation, getProjectContext, getRecentCompactedSummaries } from "../db/queries/conversations";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { AppError, NotFoundError } from "../lib/errors";
import { aggregateProjectContext, compactConversation } from "../lib/llm/compact";
import { requirePlus } from "../lib/tier";
import { requireRole } from "../middleware/project-auth";

const compaction = new Hono<{ Bindings: Env }>();
compaction.use("/conversations/*", authMiddleware);
compaction.use("/projects/*", authMiddleware);

// POST /api/conversations/:id/compact — manual compaction trigger
compaction.post("/conversations/:id/compact", async (c) => {
  requirePlus(c, "Conversation compaction");

  const user = c.get("user");
  const conversationId = c.req.param("id");
  const db = c.get("db");

  const conversation = await getConversation(db, conversationId);
  if (!conversation) throw new NotFoundError("Conversation not found");

  // Only the owner can compact
  if (conversation.user_id !== user.id) {
    throw new AppError("Only the conversation owner can compact", 403, "FORBIDDEN");
  }

  const apiKey = c.env.COMPACTION_LLM_KEY;
  if (!apiKey) {
    throw new AppError("Compaction is not configured on this server", 503, "SERVICE_UNAVAILABLE");
  }

  const model = c.env.COMPACTION_LLM_MODEL ?? "claude-haiku-4-5-20251001";

  const result = await compactConversation(db, conversationId, conversation.title, apiKey, model);

  // Re-aggregate project context
  await aggregateProjectContext(db, conversation.project_id, apiKey, model);

  return c.json({
    compacted_summary: result.summary,
    compacted_at: new Date().toISOString(),
    compaction_model: result.model,
    message_count: result.messageCount,
  });
});

// GET /api/projects/:id/context — get project-level compacted summary
compaction.get("/projects/:id/context", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const db = c.get("db");

  await requireRole(db, projectId, user.id);

  const tier = c.get("tier") ?? "free";

  if (tier !== "plus") {
    return c.json({
      summary: null,
      upgrade_hint: "Upgrade to Plus for AI-generated project context",
    });
  }

  const context = await getProjectContext(db, projectId);

  if (!context) {
    // No context yet — return recent summaries as fallback
    const recent = await getRecentCompactedSummaries(db, projectId, 5);
    if (recent.length === 0) {
      return c.json({
        summary: null,
        message: "No compacted conversations yet. Context will appear automatically as conversations are compacted.",
      });
    }

    return c.json({
      summary: recent.map((r) => `## ${r.title ?? "Untitled"}\n${r.compacted_summary}`).join("\n\n---\n\n"),
      conversation_count: recent.length,
      model: null,
      updated_at: recent[0].compacted_at,
      source: "recent_summaries",
    });
  }

  return c.json({
    summary: context.summary,
    conversation_count: context.conversation_count,
    model: context.model,
    updated_at: context.updated_at,
    source: "aggregated",
  });
});

export { compaction };
