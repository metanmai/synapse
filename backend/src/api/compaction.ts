import { Hono } from "hono";
import {
  getConversation,
  getProjectContext,
  getRecentCompactedSummaries,
  updateCompaction,
  updateConversation,
} from "../db/queries/conversations";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { AppError, NotFoundError } from "../lib/errors";
import { aggregateProjectContext, compactConversation } from "../lib/llm/compact";
import { requireRole } from "../middleware/project-auth";

const compaction = new Hono<{ Bindings: Env }>();
compaction.use("/conversations/*", authMiddleware);
compaction.use("/projects/*", authMiddleware);

// POST /api/conversations/:id/compact — compact a conversation.
//
// Two modes:
//   1. Hosted (default): server runs the LLM via COMPACTION_LLM_KEY.
//   2. Local-CLI (preferred when the caller has it): caller passes a
//      precomputed { summary, model } in the body and the server just
//      persists it. The caller is typically the capture-worker shelling
//      out to `claude -p` (or equivalent for other agents), so the
//      transcript never leaves the user's machine for a third-party LLM.
//
// Mode is selected by request-body shape. An empty/missing body falls
// back to hosted mode for backwards compatibility with existing clients.
compaction.post("/conversations/:id/compact", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const db = c.get("db");

  const conversation = await getConversation(db, conversationId);
  if (!conversation) throw new NotFoundError("Conversation not found");

  // Only the owner can compact
  if (conversation.user_id !== user.id) {
    throw new AppError("Only the conversation owner can compact", 403, "FORBIDDEN");
  }

  // Inspect body — if a precomputed summary was provided, persist it
  // directly and skip the hosted LLM call.
  const body = (await c.req.json().catch(() => ({}))) as {
    summary?: unknown;
    model?: unknown;
    handoff?: unknown;
  };
  const precomputedSummary = typeof body.summary === "string" ? body.summary.trim() : null;
  const precomputedModel = typeof body.model === "string" ? body.model.trim() : null;
  const precomputedHandoff = typeof body.handoff === "string" ? body.handoff.trim() : null;

  if (precomputedSummary && precomputedSummary.length > 0) {
    const modelTag = precomputedModel && precomputedModel.length > 0 ? precomputedModel : "client";
    await updateCompaction(db, conversationId, precomputedSummary, modelTag);

    // If an agent handoff document was provided, merge it into the
    // conversation's metadata JSON (no schema migration needed). The next
    // session's <synapse-brief> can read this back to give the next agent
    // a structured "where I left off" doc instead of re-deriving it from
    // the transcript.
    let handoffStored = false;
    if (precomputedHandoff && precomputedHandoff.length > 0) {
      const existingMetadata = (conversation.metadata ?? {}) as Record<string, unknown>;
      const mergedMetadata = {
        ...existingMetadata,
        handoff_markdown: precomputedHandoff,
        handoff_model: modelTag,
        handoff_at: new Date().toISOString(),
      };
      try {
        await updateConversation(db, conversationId, { metadata: mergedMetadata });
        handoffStored = true;
      } catch (err) {
        // Don't fail the whole compaction if metadata write fails — the
        // summary is the must-have, handoff is best-effort.
        console.error("[compact] failed to merge handoff into metadata:", err);
      }
    }

    return c.json({
      compacted_summary: precomputedSummary,
      compacted_at: new Date().toISOString(),
      compaction_model: modelTag,
      message_count: null,
      source: "client",
      handoff_stored: handoffStored,
    });
  }

  // Hosted path (existing behavior).
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
    source: "server",
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
