import type { SupabaseClient } from "@supabase/supabase-js";
import { FULLTEXT_SCORE, ILIKE_SCORE } from "../lib/constants";
import type { Entry } from "./types";

export interface ScoredEntry {
  entry: Entry;
  score: number;
}

/** Generic scored item — works with any type that has an `id` field. */
export interface ScoredItem<T extends { id: string }> {
  entry: T;
  score: number;
}

/**
 * Merge results from semantic, full-text, and ILIKE tiers.
 * Deduplicates by entry ID, keeping the highest score.
 * Returns Entry[] sorted by score descending.
 */
export function mergeSearchResults(semantic: ScoredEntry[], fulltext: ScoredEntry[], ilike: ScoredEntry[]): Entry[] {
  return mergeSearchTiers<Entry>(semantic, fulltext, ilike);
}

/**
 * Generic merge for any type with an `id` field.
 * Deduplicates by ID, keeping the highest score.
 * Returns T[] sorted by score descending.
 */
export function mergeSearchTiers<T extends { id: string }>(...tiers: ScoredItem<T>[][]): T[] {
  const bestById = new Map<string, ScoredItem<T>>();

  for (const tier of tiers) {
    for (const scored of tier) {
      const existing = bestById.get(scored.entry.id);
      if (!existing || scored.score > existing.score) {
        bestById.set(scored.entry.id, scored);
      }
    }
  }

  return Array.from(bestById.values())
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);
}

/**
 * Split a search query into individual words for ILIKE matching.
 * Filters out words shorter than 2 characters.
 */
export function buildIlikeWords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Run full-text search on a Supabase table using its search_vector column.
 * Returns scored items for merging with other search tiers.
 */
export async function runFulltextSearch<T extends { id: string }>(
  db: SupabaseClient,
  table: string,
  columns: string,
  projectId: string,
  query: string,
  filters?: { folder?: string; tags?: string[] },
  score: number = FULLTEXT_SCORE,
): Promise<ScoredItem<T>[]> {
  let q = db.from(table).select(columns).eq("project_id", projectId).textSearch("search_vector", query, {
    type: "websearch",
  });

  if (filters?.folder) q = q.like("path", `${filters.folder}/%`);
  if (filters?.tags?.length) q = q.overlaps("tags", filters.tags);

  const { data, error } = await q;
  if (error) {
    console.error(`[search] ${table} fulltext error:`, error.message);
    return [];
  }
  return (data ?? []).map((row: T) => ({ entry: row, score }));
}

/**
 * Run ILIKE word search on a Supabase table.
 * Builds OR clauses from query words across the specified search fields.
 * Returns scored items for merging with other search tiers.
 */
export async function runIlikeSearch<T extends { id: string }>(
  db: SupabaseClient,
  table: string,
  columns: string,
  projectId: string,
  query: string,
  searchFields: string[],
  filters?: { folder?: string; tags?: string[] },
  score: number = ILIKE_SCORE,
): Promise<ScoredItem<T>[]> {
  const words = buildIlikeWords(query);
  if (words.length === 0) return [];

  const orClauses = words
    .map((w) => {
      const p = `%${w}%`;
      return searchFields.map((f) => `${f}.ilike.${p}`).join(",");
    })
    .join(",");

  let q = db.from(table).select(columns).eq("project_id", projectId).or(orClauses);

  if (filters?.folder) q = q.like("path", `${filters.folder}/%`);
  if (filters?.tags?.length) q = q.overlaps("tags", filters.tags);

  const { data, error } = await q;
  if (error) {
    console.error(`[search] ${table} ilike error:`, error.message);
    return [];
  }
  return (data ?? []).map((row: T) => ({ entry: row, score }));
}
