import { Hono } from "hono";

import { logActivity } from "../db/activity-logger";
import { createInsight, deleteInsight, getInsight, listInsights, updateInsight } from "../db/queries";
import { countActiveInsightsForProject, evictOldestInsightForProject } from "../db/queries/insights";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { ForbiddenError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";
import { consolidateOldestInsights } from "../lib/llm/insight-consolidate";
import { type Tier, getInsightCapForTier } from "../lib/tier";
import { parseBody, schemas } from "../lib/validate";
import { requireRole } from "../middleware/project-auth";

const insights = new Hono<{ Bindings: Env }>();
insights.use("*", authMiddleware);
insights.use("*", idempotency);

// GET /api/insights — list insights for a project
insights.get("/", async (c) => {
  const user = c.get("user");
  const projectId = c.req.query("project_id");
  if (!projectId) {
    return c.json({ error: "project_id query parameter is required", code: "VALIDATION_ERROR" }, 400);
  }

  const type = c.req.query("type") as
    | "decision"
    | "learning"
    | "preference"
    | "architecture"
    | "action_item"
    | undefined;
  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");
  const limit = limitStr ? Number.parseInt(limitStr) : undefined;
  const offset = offsetStr ? Number.parseInt(offsetStr) : undefined;
  // Curation knob (migration 024). Default false — briefs / dashboards
  // should NOT show superseded rows. Pass `?include_superseded=true` to
  // get the full audit history including replaced insights.
  const includeSuperseded = c.req.query("include_superseded") === "true";

  const db = c.get("db");

  // Verify the user is a member of the project
  await requireRole(db, projectId, user.id);

  const result = await listInsights(db, projectId, { type, limit, offset, includeSuperseded });
  return c.json(result);
});

// POST /api/insights — create an insight
insights.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, schemas.createInsight);

  const db = c.get("db");

  // Verify the user is at least an editor on the project
  await requireRole(db, body.project_id, user.id, "editor");

  // Phase 03-04: per-project insight cap.
  //  - Free (cap=10): silently evict the oldest active insight before insert.
  //  - Plus (cap=50): insert succeeds; fire ctx.waitUntil() to consolidate
  //    the oldest 10 via Haiku in the background. The user is transiently
  //    over-cap until consolidation completes (~5-15s). LLM failures log
  //    + drop; daily cron (runDailyConsolidationRetry) catches up.
  const tier = (c.get("tier") ?? "free") as Tier;
  const cap = getInsightCapForTier(tier);
  let activeCount: number;
  try {
    activeCount = await countActiveInsightsForProject(db, body.project_id);
  } catch {
    activeCount = 0; // already logged; treat as "below cap" so the insert proceeds
  }
  if (activeCount >= cap) {
    if (tier === "free") {
      await evictOldestInsightForProject(db, body.project_id);
    } else {
      // Plus: defer to ctx.waitUntil so the response isn't blocked on Haiku.
      const apiKey = c.env.COMPACTION_LLM_KEY;
      if (apiKey) {
        c.executionCtx.waitUntil(
          consolidateOldestInsights(db, body.project_id, apiKey).catch((e) => {
            console.error(
              `[insights/post] consolidate waitUntil rejected for ${body.project_id}: ${e instanceof Error ? e.message : e}`,
            );
          }),
        );
      }
    }
  }

  const insight = await createInsight(db, {
    project_id: body.project_id,
    user_id: user.id,
    type: body.type,
    summary: body.summary,
    detail: body.detail ?? null,
    source: body.source ?? null,
    // Pass-through curation list. createInsight() does the project-scoped,
    // idempotent UPDATE post-insert; failures there are non-fatal and
    // logged, so the API response shape stays stable regardless.
    supersedes: body.supersedes,
  });

  await logActivity(db, {
    project_id: body.project_id,
    user_id: user.id,
    action: "insight_created",
    source: "human",
    metadata: { type: body.type, insight_id: insight.id },
  });

  return c.json(insight, 201);
});

// PATCH /api/insights/:id — update an insight
insights.patch("/:id", async (c) => {
  const user = c.get("user");
  const insightId = c.req.param("id");
  const body = await parseBody(c, schemas.updateInsight);

  const db = c.get("db");

  const existing = await getInsight(db, insightId);
  if (!existing) throw new NotFoundError("Insight not found");

  // Only the owner can edit
  if (existing.user_id !== user.id) {
    throw new ForbiddenError("Only the insight owner can edit");
  }

  const updated = await updateInsight(db, insightId, body);

  await logActivity(db, {
    project_id: existing.project_id,
    user_id: user.id,
    action: "insight_updated",
    source: "human",
    metadata: { insight_id: insightId },
  });

  return c.json(updated);
});

// DELETE /api/insights/:id — delete an insight
insights.delete("/:id", async (c) => {
  const user = c.get("user");
  const insightId = c.req.param("id");

  const db = c.get("db");

  const existing = await getInsight(db, insightId);
  if (!existing) throw new NotFoundError("Insight not found");

  // Only the owner can delete
  if (existing.user_id !== user.id) {
    throw new ForbiddenError("Only the insight owner can delete");
  }

  await deleteInsight(db, insightId);

  await logActivity(db, {
    project_id: existing.project_id,
    user_id: user.id,
    action: "insight_deleted",
    source: "human",
    metadata: { insight_id: insightId, type: existing.type },
  });

  return c.json({ ok: true });
});

export { insights };
