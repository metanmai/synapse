import { createSupabaseClient } from "../db/client";
import { countActiveInsightsForProject } from "../db/queries/insights";
import type { Env } from "../lib/env";
import { consolidateOldestInsights } from "../lib/llm/insight-consolidate";

/**
 * Cap above which a Plus project is considered "stuck over-cap" and
 * needs a retry consolidation pass. Mirrors PLUS_INSIGHTS_PER_PROJECT
 * (50) so a single fresh overflow doesn't fire the cron path — only
 * persistently-over-cap projects do.
 */
const RETRY_THRESHOLD = 50;
const MAX_PROJECTS_PER_RUN = 50;

/**
 * Daily catch-up for Plus projects whose POST /api/insights ctx.waitUntil
 * consolidation failed (LLM outage, parse failure, request abort, etc.).
 *
 * Triggered by the scheduled handler at backend/src/index.ts (same cron
 * slot as runDailyAggregation). Belt-and-suspenders against the transient-
 * outage scenario: a Plus user saves their 51st insight during an Anthropic
 * blip, ctx.waitUntil's call fails silently, user is stuck at 51 active.
 * Without this cron, they'd stay over-cap until they happened to save
 * another insight (next overflow attempt). With this cron, they catch up
 * within 24h.
 *
 * Best-effort and bounded: skips silently if no LLM key configured, caps
 * at MAX_PROJECTS_PER_RUN to avoid pathological runs. Errors log + continue
 * — one failing project shouldn't block consolidation for the rest.
 */
export async function runDailyConsolidationRetry(env: Env): Promise<void> {
  const apiKey = env.COMPACTION_LLM_KEY;
  if (!apiKey) {
    console.log("[consolidate-retry] no LLM key configured, skipping");
    return;
  }

  const model = env.COMPACTION_LLM_MODEL ?? "claude-haiku-4-5-20251001";
  const db = createSupabaseClient(env);

  // Find Plus projects where active insight count exceeds the threshold.
  // We can't pre-compute count cheaply in a single SQL, so the strategy is:
  // pull Plus subscribers' project IDs, then count per project. Cap the
  // scan at MAX_PROJECTS_PER_RUN to keep the cron under the 30s budget.
  //
  // (A SQL view / RPC would be cleaner but requires a migration; that's a
  // future optimization. The current shape works because few Plus users
  // will be over-cap on any given day.)
  const { data: subs, error: subErr } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("status", "active")
    .limit(MAX_PROJECTS_PER_RUN);
  if (subErr) {
    console.error("[consolidate-retry] failed to query Plus subscribers:", subErr.message);
    return;
  }
  if (!subs || subs.length === 0) {
    console.log("[consolidate-retry] no Plus subscribers");
    return;
  }

  const plusUserIds = subs.map((s) => s.user_id);

  const { data: projects, error: projErr } = await db
    .from("projects")
    .select("id")
    .in("owner_id", plusUserIds)
    .limit(MAX_PROJECTS_PER_RUN);
  if (projErr || !projects) {
    console.error("[consolidate-retry] failed to query Plus projects:", projErr?.message);
    return;
  }

  let retried = 0;
  let succeeded = 0;
  for (const p of projects as { id: string }[]) {
    let count: number;
    try {
      count = await countActiveInsightsForProject(db, p.id);
    } catch {
      continue; // already logged in the helper
    }
    if (count <= RETRY_THRESHOLD) continue;

    retried++;
    try {
      const r = await consolidateOldestInsights(db, p.id, apiKey, model);
      if (!r.error) succeeded++;
      console.log(
        `[consolidate-retry] project ${p.id}: was ${count} active, consolidated=${r.consolidated} replacements=${r.replacements} error=${r.error ?? "(none)"}`,
      );
    } catch (e) {
      console.error(`[consolidate-retry] threw for ${p.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `[consolidate-retry] scanned ${projects.length} Plus project(s); retried ${retried}; succeeded ${succeeded}`,
  );
}
