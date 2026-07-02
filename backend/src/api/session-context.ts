import { Hono } from "hono";
import { getProjectContext, getRecentCompactedSummaries, listInsights } from "../db/queries";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { requireRole } from "../middleware/project-auth";

const sessionContext = new Hono<{ Bindings: Env }>();
sessionContext.use("/projects/*", authMiddleware);
sessionContext.use("/workspace/*", authMiddleware);

// GET /projects/:id/session-context
sessionContext.get("/projects/:id/session-context", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const db = c.get("db");

  await requireRole(db, projectId, user.id);

  const [projectContext, recentSummaries, insightList] = await Promise.all([
    getProjectContext(db, projectId).catch(() => null),
    getRecentCompactedSummaries(db, projectId, 3).catch(() => []),
    listInsights(db, projectId, { limit: 10 }).catch(() => ({ insights: [], total: 0 })),
  ]);

  return c.json({
    project_id: projectId,
    summary: projectContext?.summary ?? null,
    summary_source: projectContext?.summary ? "aggregated" : recentSummaries.length > 0 ? "recent_summaries" : null,
    summary_updated_at: projectContext?.updated_at ?? recentSummaries[0]?.compacted_at ?? null,
    recent_conversations: recentSummaries.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      compacted_summary: r.compacted_summary,
      compacted_at: r.compacted_at,
    })),
    insights: insightList.insights,
  });
});

// GET /workspace/recent-projects
sessionContext.get("/workspace/recent-projects", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  const { data, error } = await db
    .from("projects")
    .select("id, name, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw error;

  return c.json({ projects: data ?? [] });
});

export { sessionContext };
