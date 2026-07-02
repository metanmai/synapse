import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../db/client";
import { PROJECT_MERGE_THRESHOLD, RECONCILE_BACKFILL_CAP, RECONCILE_OWNERS_PER_RUN } from "../lib/constants";
import { type EmbeddingConfig, embedTexts, embeddingConfigFromEnv } from "../lib/embeddings";
import type { Env } from "../lib/env";
import { recomputeProjectStatus } from "../lib/handoff-reducer";
import { type ProjLite, chooseMergeTarget, isStableCandidate } from "../lib/project-correlation";

export interface ReconcileSummary {
  backfilled: number;
  candidates: number;
  merged: number;
}

const MAX_PAIRS_PER_OWNER = 20;

/**
 * Daily AI project-correlation reconciler (spec:
 * docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md). Two
 * deterministic, LLM-free steps: (1) backfill conversation embeddings so
 * cross-source matching converges, (2) merge fragmented projects with 2-run
 * hysteresis. Triggered by the daily cron (index.ts) and the internal endpoint.
 * Best-effort: degrades to a no-op when embeddings are unconfigured.
 */
export async function reconcileProjects(env: Env): Promise<ReconcileSummary> {
  const db = createSupabaseClient(env);
  const cfg = embeddingConfigFromEnv(env);
  const summary: ReconcileSummary = { backfilled: 0, candidates: 0, merged: 0 };

  if (cfg.url) {
    try {
      summary.backfilled = await backfillEmbeddings(db, cfg);
    } catch (e) {
      console.error("[reconcile] backfill failed:", e instanceof Error ? e.message : e);
    }
  }

  try {
    const m = await reconcileMerges(db, Date.now());
    summary.candidates = m.candidates;
    summary.merged = m.merged;
  } catch (e) {
    console.error("[reconcile] merge pass failed:", e instanceof Error ? e.message : e);
  }

  console.log(`[reconcile] backfilled=${summary.backfilled} candidates=${summary.candidates} merged=${summary.merged}`);
  return summary;
}

/**
 * Embed up to RECONCILE_BACKFILL_CAP conversations that have a title but no
 * embedding yet (chiefly git captures, which assign deterministically and don't
 * embed at capture). Makes them future kNN neighbours for cross-source grouping.
 */
export async function backfillEmbeddings(
  db: SupabaseClient,
  cfg: EmbeddingConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<number> {
  const { data: rows, error } = await db
    .from("conversations")
    .select("id, title")
    .is("embedding", null)
    .eq("status", "active")
    .limit(RECONCILE_BACKFILL_CAP);
  if (error || !rows) return 0;

  const withTitle = (rows as { id: string; title: string | null }[]).filter(
    (r) => typeof r.title === "string" && r.title.trim().length > 0,
  );
  if (withTitle.length === 0) return 0;

  const vecs = await embedTexts(
    withTitle.map((r) => r.title as string),
    "search_document",
    cfg,
    fetchFn,
  );
  if (!vecs) return 0;

  let n = 0;
  for (let i = 0; i < withTitle.length; i++) {
    const v = vecs[i];
    if (!v) continue;
    const { error: upErr } = await db
      .from("conversations")
      .update({ embedding: JSON.stringify(v) })
      .eq("id", withTitle[i].id);
    if (!upErr) n++;
  }
  return n;
}

/** Loop over owners (capped) and reconcile each one's projects. */
export async function reconcileMerges(
  db: SupabaseClient,
  runStartMs: number,
): Promise<{ candidates: number; merged: number }> {
  const { data: projRows, error } = await db.from("projects").select("owner_id").limit(2000);
  if (error || !projRows) return { candidates: 0, merged: 0 };

  const owners = [...new Set((projRows as { owner_id: string }[]).map((r) => r.owner_id))].slice(
    0,
    RECONCILE_OWNERS_PER_RUN,
  );

  let candidates = 0;
  let merged = 0;
  for (const owner of owners) {
    try {
      const r = await reconcileMergesForOwner(db, owner, runStartMs);
      candidates += r.candidates;
      merged += r.merged;
    } catch (e) {
      console.error(`[reconcile] owner ${owner} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { candidates, merged };
}

/**
 * For one owner: find highly-similar project pairs, record them, and merge those
 * that have survived a prior run (2-run hysteresis). A pair is merged on its
 * SECOND consecutive sighting — first sighting only records a pending candidate.
 */
export async function reconcileMergesForOwner(
  db: SupabaseClient,
  ownerId: string,
  runStartMs: number,
): Promise<{ candidates: number; merged: number }> {
  const { data: pairs, error } = await db.rpc("find_merge_candidates", {
    match_user_id: ownerId,
    sim_threshold: PROJECT_MERGE_THRESHOLD,
    max_pairs: MAX_PAIRS_PER_OWNER,
  });
  if (error || !pairs) return { candidates: 0, merged: 0 };

  let candidates = 0;
  let merged = 0;
  for (const pair of pairs as { project_a: string; project_b: string; score: number }[]) {
    const { project_a, project_b, score } = pair; // a < b (canonical, from SQL)

    const { data: existing } = await db
      .from("project_merge_candidates")
      .select("id, status, first_seen_at")
      .eq("project_low", project_a)
      .eq("project_high", project_b)
      .maybeSingle();

    if (!existing) {
      await db.from("project_merge_candidates").insert({
        owner_id: ownerId,
        project_low: project_a,
        project_high: project_b,
        score,
        status: "pending",
      });
      candidates++;
      continue;
    }

    const row = existing as { id: string; status: string; first_seen_at: string };
    if (row.status !== "pending") continue; // already merged

    if (!isStableCandidate(Date.parse(row.first_seen_at), runStartMs)) {
      // First-run sighting (or same run) — just refresh, don't merge yet.
      await db
        .from("project_merge_candidates")
        .update({ score, last_seen_at: new Date().toISOString() })
        .eq("id", row.id);
      continue;
    }

    // Stable across runs → merge. Real project absorbs synthetic buckets.
    const { data: projs } = await db.from("projects").select("id, name, created_at").in("id", [project_a, project_b]);
    const list = (projs ?? []) as { id: string; name: string; created_at: string }[];
    if (list.length !== 2) continue;

    const lite: ProjLite[] = list.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: Date.parse(p.created_at),
    }));
    const { target, source } = chooseMergeTarget(lite[0], lite[1]);

    const { error: mergeErr } = await db.rpc("merge_projects", {
      p_source_id: source.id,
      p_target_id: target.id,
      p_user_id: ownerId,
    });
    if (mergeErr) {
      console.error(`[reconcile] merge_projects failed for ${source.id}→${target.id}:`, mergeErr.message);
      continue;
    }
    await db.from("project_merge_candidates").update({ status: "merged" }).eq("id", row.id);
    // Recompute is a post-merge nicety; a failure here must not undo the merge.
    try {
      await recomputeProjectStatus(db, target.id);
    } catch (e) {
      console.error("[reconcile] recompute after merge failed:", e instanceof Error ? e.message : e);
    }
    merged++;
  }
  return { candidates, merged };
}
