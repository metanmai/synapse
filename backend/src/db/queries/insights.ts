import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import { mergeSearchTiers, runFulltextSearch, runIlikeSearch } from "../search-helpers";
import type { Insight, InsightListItem, InsightSource, InsightType } from "../types";

const INSIGHT_COLUMNS =
  "id, project_id, user_id, type, summary, detail, source, encrypted, created_at, updated_at, superseded_by";

const INSIGHT_LIST_COLUMNS = "id, type, summary, source, created_at, updated_at, superseded_by";

export async function createInsight(
  db: SupabaseClient,
  params: {
    project_id: string;
    user_id: string;
    type: InsightType;
    summary: string;
    detail?: string | null;
    source?: InsightSource | null;
    encrypted?: boolean;
    /**
     * Optional list of insight UUIDs this new insight replaces. After the
     * INSERT succeeds, those rows get `superseded_by = <new_id>` set so
     * they stop appearing in default brief / list queries.
     *
     * Scope rules (enforced in the UPDATE WHERE clause, not the caller):
     *   - same project only (no cross-project supersession)
     *   - only already-active rows get stamped (idempotent on retry)
     *
     * Failures stamping individual rows are non-fatal — they're logged and
     * swallowed. The contract is "the new insight saved"; the supersession
     * stamp is a best-effort cleanup that the next call can re-apply.
     */
    supersedes?: string[];
  },
): Promise<Insight> {
  const { data, error } = await db
    .from("insights")
    .insert({
      project_id: params.project_id,
      user_id: params.user_id,
      type: params.type,
      summary: params.summary,
      detail: params.detail ?? null,
      source: params.source ?? null,
      encrypted: params.encrypted ?? false,
    })
    .select(INSIGHT_COLUMNS)
    .single();
  if (error) throw error;
  const insight = data as Insight;

  // Best-effort supersession stamp. Empty / undefined → no-op.
  if (params.supersedes && params.supersedes.length > 0) {
    try {
      const { error: supersedeError } = await db
        .from("insights")
        .update({ superseded_by: insight.id })
        .in("id", params.supersedes)
        // SECURITY: only stamp rows in the same project — prevents a
        // malicious caller from pointing supersedes at insight ids in
        // projects they don't own.
        .eq("project_id", params.project_id)
        // IDEMPOTENT: if a row was already superseded by a previous call,
        // leave its existing pointer alone. Re-running save_insight with
        // the same supersedes list should be a no-op, not a re-stamp.
        .is("superseded_by", null);
      if (supersedeError) {
        console.error(
          `[db] createInsight: supersession stamp failed for ${params.supersedes.length} row(s) — ${supersedeError.message}`,
        );
      }
    } catch (e) {
      console.error(`[db] createInsight: supersession stamp threw — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return insight;
}

export async function listInsights(
  db: SupabaseClient,
  projectId: string,
  options?: { type?: InsightType; limit?: number; offset?: number; includeSuperseded?: boolean },
): Promise<{ insights: InsightListItem[]; total: number }> {
  const includeSuperseded = options?.includeSuperseded ?? false;

  // Get total count
  let countQuery = db.from("insights").select("*", { count: "exact", head: true }).eq("project_id", projectId);

  if (options?.type) {
    countQuery = countQuery.eq("type", options.type);
  }
  if (!includeSuperseded) {
    countQuery = countQuery.is("superseded_by", null);
  }

  const { count, error: countError } = await countQuery;
  if (countError) throw countError;

  // Get paginated results
  let query = db
    .from("insights")
    .select(INSIGHT_LIST_COLUMNS)
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (options?.type) {
    query = query.eq("type", options.type);
  }
  if (!includeSuperseded) {
    query = query.is("superseded_by", null);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    insights: (data ?? []) as InsightListItem[],
    total: count ?? 0,
  };
}

export async function getInsight(db: SupabaseClient, insightId: string): Promise<Insight | null> {
  return singleOrNull<Insight>(await db.from("insights").select(INSIGHT_COLUMNS).eq("id", insightId).single());
}

export async function updateInsight(
  db: SupabaseClient,
  insightId: string,
  params: {
    type?: InsightType;
    summary?: string;
    detail?: string | null;
    source?: InsightSource | null;
    encrypted?: boolean;
  },
): Promise<Insight> {
  const updates: Record<string, unknown> = {};
  if (params.type !== undefined) updates.type = params.type;
  if (params.summary !== undefined) updates.summary = params.summary;
  if (params.detail !== undefined) updates.detail = params.detail;
  if (params.source !== undefined) updates.source = params.source;
  if (params.encrypted !== undefined) updates.encrypted = params.encrypted;

  const { data, error } = await db
    .from("insights")
    .update(updates)
    .eq("id", insightId)
    .select(INSIGHT_COLUMNS)
    .single();
  if (error) throw error;
  return data as Insight;
}

export async function deleteInsight(db: SupabaseClient, insightId: string): Promise<void> {
  const { error } = await db.from("insights").delete().eq("id", insightId);
  if (error) throw error;
}

export async function searchInsights(db: SupabaseClient, projectId: string, query: string): Promise<Insight[]> {
  // Run full-text and ILIKE tiers in parallel
  const [fulltext, ilike] = await Promise.all([
    runFulltextSearch<Insight>(db, "insights", INSIGHT_COLUMNS, projectId, query),
    runIlikeSearch<Insight>(db, "insights", INSIGHT_COLUMNS, projectId, query, ["summary", "detail"]),
  ]);

  // Deduplicate, keeping highest-scored results first (fulltext > ilike)
  return mergeSearchTiers<Insight>(fulltext, ilike);
}

// --- Phase 03-04: per-project insight cap (Free LRU + Plus LLM-consolidate) ---

/**
 * Count active (non-superseded) insights for a project. Used by the per-tier
 * cap path: Free at 10, Plus at 50. Counts WHERE superseded_by IS NULL so
 * already-curated rows don't push the user over.
 */
export async function countActiveInsightsForProject(db: SupabaseClient, projectId: string): Promise<number> {
  const { count, error } = await db
    .from("insights")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("superseded_by", null);
  if (error) {
    console.error(`[db] countActiveInsightsForProject ${projectId} failed: ${error.message}`);
    throw error;
  }
  return count ?? 0;
}

/**
 * Fetch the N oldest ACTIVE insights for a project, ordered by updated_at ASC.
 * Used by Plus LLM consolidation (oldest 10 → 3-5 merged replacements with
 * supersedes) and indirectly by Free LRU eviction (n=1).
 *
 * Returns full rows so consolidation has the user_id and summary/detail
 * payload for the prompt.
 */
export async function getOldestActiveInsights(db: SupabaseClient, projectId: string, n: number): Promise<Insight[]> {
  const { data, error } = await db
    .from("insights")
    .select(INSIGHT_COLUMNS)
    .eq("project_id", projectId)
    .is("superseded_by", null)
    .order("updated_at", { ascending: true })
    .limit(n);
  if (error) {
    console.error(`[db] getOldestActiveInsights ${projectId} (n=${n}) failed: ${error.message}`);
    throw error;
  }
  return (data ?? []) as Insight[];
}

/**
 * Evict (HARD DELETE) the single oldest active insight in a project (Free
 * LRU path). NOT supersession — supersession preserves history for audit;
 * eviction is for capacity and the row is gone forever. This is intentional
 * per .planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md.
 *
 * Best-effort: returns the evicted ID or null on no-op / error. Errors are
 * LOGGED, never thrown — the subsequent createInsight must not be blocked
 * by an eviction failure (user would just go over-cap by 1 until next
 * eviction attempt).
 */
export async function evictOldestInsightForProject(db: SupabaseClient, projectId: string): Promise<string | null> {
  let oldest: Insight[];
  try {
    oldest = await getOldestActiveInsights(db, projectId, 1);
  } catch {
    return null; // already logged in getOldestActiveInsights
  }
  if (oldest.length === 0) return null;
  const id = oldest[0].id;
  const { error } = await db.from("insights").delete().eq("id", id);
  if (error) {
    console.error(`[db] evictOldestInsightForProject delete ${id} failed: ${error.message}`);
    return null;
  }
  return id;
}
