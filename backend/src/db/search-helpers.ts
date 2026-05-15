import type { Entry } from "./types";

export interface ScoredEntry {
  entry: Entry;
  score: number;
}

/**
 * Merge results from semantic, full-text, and ILIKE tiers.
 * Deduplicates by entry ID, keeping the highest score.
 * Returns Entry[] sorted by score descending.
 */
export function mergeSearchResults(semantic: ScoredEntry[], fulltext: ScoredEntry[], ilike: ScoredEntry[]): Entry[] {
  const bestByid = new Map<string, ScoredEntry>();

  for (const scored of [...semantic, ...fulltext, ...ilike]) {
    const existing = bestByid.get(scored.entry.id);
    if (!existing || scored.score > existing.score) {
      bestByid.set(scored.entry.id, scored);
    }
  }

  return Array.from(bestByid.values())
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
