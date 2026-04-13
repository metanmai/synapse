import { createSupabaseClient } from "../db/client";
import type { Env } from "../lib/env";
import { aggregateProjectContext } from "../lib/llm/compact";

const MAX_PROJECTS_PER_RUN = 50;

export async function runDailyAggregation(env: Env): Promise<void> {
  const apiKey = env.COMPACTION_LLM_KEY;
  if (!apiKey) {
    console.log("[aggregate] COMPACTION_LLM_KEY not configured, skipping daily aggregation");
    return;
  }

  const model = env.COMPACTION_LLM_MODEL ?? "claude-haiku-4-5-20251001";
  const db = createSupabaseClient(env);

  // Find projects with compacted conversations — query distinct project_ids
  const { data: rows, error } = await db
    .from("conversations")
    .select("project_id")
    .not("compacted_summary", "is", null)
    .order("compacted_at", { ascending: false })
    .limit(MAX_PROJECTS_PER_RUN);

  if (error || !rows) {
    console.error("[aggregate] Failed to query projects:", error);
    return;
  }

  const uniqueProjectIds = [...new Set(rows.map((r) => r.project_id))];

  if (uniqueProjectIds.length === 0) {
    console.log("[aggregate] No projects need aggregation");
    return;
  }

  for (const projectId of uniqueProjectIds) {
    try {
      await aggregateProjectContext(db, projectId, apiKey, model);
      console.log(`[aggregate] Updated project context for ${projectId}`);
    } catch (err) {
      console.error(`[aggregate] Failed for project ${projectId}:`, err);
    }
  }

  console.log(`[aggregate] Processed ${uniqueProjectIds.length} project(s)`);
}
