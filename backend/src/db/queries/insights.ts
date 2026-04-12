import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import { mergeSearchTiers, runFulltextSearch, runIlikeSearch } from "../search-helpers";
import type { Insight, InsightListItem, InsightSource, InsightType } from "../types";

const INSIGHT_COLUMNS = "id, project_id, user_id, type, summary, detail, source, encrypted, created_at, updated_at";

const INSIGHT_LIST_COLUMNS = "id, type, summary, source, created_at, updated_at";

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
  return data as Insight;
}

export async function listInsights(
  db: SupabaseClient,
  projectId: string,
  options?: { type?: InsightType; limit?: number; offset?: number },
): Promise<{ insights: InsightListItem[]; total: number }> {
  // Get total count
  let countQuery = db.from("insights").select("*", { count: "exact", head: true }).eq("project_id", projectId);

  if (options?.type) {
    countQuery = countQuery.eq("type", options.type);
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
