import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import { buildIlikeWords, mergeSearchResults, type ScoredEntry } from "../search-helpers";
import type { Entry, EntryHistory } from "../types";

const ENTRY_COLUMNS = "id, project_id, path, content, content_type, author_id, source, tags, google_doc_id, created_at, updated_at";

export async function upsertEntry(
  db: SupabaseClient,
  params: {
    project_id: string;
    path: string;
    content: string;
    content_type?: "markdown" | "json";
    author_id?: string | null;
    source?: string;
    tags?: string[];
  },
): Promise<Entry> {
  // Check if entry exists at this path
  const { data: existing } = await db
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("project_id", params.project_id)
    .eq("path", params.path)
    .single();

  if (existing) {
    // Save current version to history
    await db.from("entry_history").insert({
      entry_id: existing.id,
      content: existing.content,
      source: existing.source,
    });

    // Update entry
    const { data, error } = await db
      .from("entries")
      .update({
        content: params.content,
        content_type: params.content_type ?? existing.content_type,
        author_id: params.author_id ?? existing.author_id,
        source: params.source ?? existing.source,
        tags: params.tags ?? existing.tags,
      })
      .eq("id", existing.id)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) throw error;
    return data as Entry;
  }

  // Create new entry
  const { data, error } = await db
    .from("entries")
    .insert({
      project_id: params.project_id,
      path: params.path,
      content: params.content,
      content_type: params.content_type ?? "markdown",
      author_id: params.author_id ?? null,
      source: params.source ?? "claude",
      tags: params.tags ?? [],
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  return data as Entry;
}

export async function getEntry(db: SupabaseClient, projectId: string, path: string): Promise<Entry | null> {
  return singleOrNull<Entry>(
    await db.from("entries").select(ENTRY_COLUMNS).eq("project_id", projectId).eq("path", path).single(),
  );
}

export async function listEntries(
  db: SupabaseClient,
  projectId: string,
  folder?: string,
): Promise<Pick<Entry, "path" | "content_type" | "tags" | "updated_at">[]> {
  let query = db
    .from("entries")
    .select("path, content_type, tags, updated_at")
    .eq("project_id", projectId)
    .order("path", { ascending: true });

  if (folder) {
    query = query.like("path", `${folder}/%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function searchEntries(
  db: SupabaseClient,
  projectId: string,
  query: string,
  options?: { tags?: string[]; folder?: string },
  queryEmbedding?: number[] | null,
): Promise<Entry[]> {
  // --- Tier 1: Semantic search (if we have an embedding) ---
  const semanticPromise: Promise<ScoredEntry[]> = queryEmbedding
    ? Promise.resolve(
        db
          .rpc("match_entries", {
            query_embedding: JSON.stringify(queryEmbedding),
            match_project_id: projectId,
            match_threshold: 0.3,
            match_count: 10,
          })
          .then(({ data, error }) => {
            if (error) {
              console.error("[search] semantic error:", error.message);
              return [];
            }
            return (data ?? []).map((row: Entry & { similarity: number }) => {
              const { similarity, ...entry } = row;
              return { entry: entry as Entry, score: similarity };
            });
          }),
      )
    : Promise.resolve([]);

  // --- Tier 2: Full-text search ---
  let ftQuery = db
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("project_id", projectId)
    .textSearch("search_vector", query, { type: "websearch" });

  if (options?.folder) ftQuery = ftQuery.like("path", `${options.folder}/%`);
  if (options?.tags?.length) ftQuery = ftQuery.overlaps("tags", options.tags);

  const fulltextPromise: Promise<ScoredEntry[]> = Promise.resolve(
    ftQuery.then(({ data, error }) => {
      if (error) {
        console.error("[search] fulltext error:", error.message);
        return [];
      }
      // TODO: Use ts_rank for proper intra-tier ordering (requires RPC function).
      // For v1, all full-text results get a fixed score of 0.5 (below semantic, above ILIKE).
      return (data ?? []).map((e: Entry) => ({ entry: e, score: 0.5 }));
    }),
  );

  // --- Tier 3: ILIKE word search ---
  const words = buildIlikeWords(query);
  const ilikePromise: Promise<ScoredEntry[]> =
    words.length > 0
      ? (() => {
          const orClauses = words
            .map((w) => {
              const p = `%${w}%`;
              return `path.ilike.${p},content.ilike.${p}`;
            })
            .join(",");

          let iq = db
            .from("entries")
            .select(ENTRY_COLUMNS)
            .eq("project_id", projectId)
            .or(orClauses);

          if (options?.folder) iq = iq.like("path", `${options.folder}/%`);
          if (options?.tags?.length) iq = iq.overlaps("tags", options.tags);

          return Promise.resolve(
            iq.then(({ data, error }) => {
              if (error) {
                console.error("[search] ilike error:", error.message);
                return [];
              }
              return (data ?? []).map((e: Entry) => ({ entry: e, score: 0.1 }));
            }),
          );
        })()
      : Promise.resolve([]);

  // Run all three tiers in parallel
  const [semantic, fulltext, ilike] = await Promise.all([
    semanticPromise,
    fulltextPromise,
    ilikePromise,
  ]);

  return mergeSearchResults(semantic, fulltext, ilike);
}

export async function getRecentEntries(db: SupabaseClient, projectId: string, limit = 20): Promise<Entry[]> {
  const { data, error } = await db
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function getAllEntries(db: SupabaseClient, projectId: string): Promise<Entry[]> {
  const { data, error } = await db
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("project_id", projectId)
    .order("path", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function countEntries(db: SupabaseClient, projectId: string): Promise<number> {
  const { count, error } = await db
    .from("entries")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) throw error;
  return count ?? 0;
}

export async function countUniqueConnections(db: SupabaseClient, projectId: string): Promise<number> {
  // Count unique sources that have written to this project
  const { data, error } = await db
    .from("activity_log")
    .select("source")
    .eq("project_id", projectId)
    .in("action", ["entry_created", "entry_updated"]);
  if (error) throw error;
  const uniqueSources = new Set((data ?? []).map((d: { source: string }) => d.source));
  return uniqueSources.size;
}

export async function deleteEntry(db: SupabaseClient, projectId: string, path: string): Promise<void> {
  const { error } = await db.from("entries").delete().eq("project_id", projectId).eq("path", path);
  if (error) throw error;
}

export async function getEntryHistory(db: SupabaseClient, projectId: string, path: string): Promise<EntryHistory[]> {
  // First get the entry ID
  const { data: entry } = await db.from("entries").select("id").eq("project_id", projectId).eq("path", path).single();

  if (!entry) return [];

  const { data, error } = await db
    .from("entry_history")
    .select("*")
    .eq("entry_id", entry.id)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EntryHistory[];
}

export async function restoreEntry(
  db: SupabaseClient,
  projectId: string,
  path: string,
  historyId: string,
): Promise<Entry | null> {
  // Get the history record
  const { data: historyRecord, error: histError } = await db
    .from("entry_history")
    .select("*")
    .eq("id", historyId)
    .single();
  if (histError) throw histError;
  if (!historyRecord) return null;

  // Upsert restores the content (upsertEntry handles versioning)
  const { data: existing } = await db.from("entries").select(ENTRY_COLUMNS).eq("project_id", projectId).eq("path", path).single();

  if (!existing) return null;

  // Save current to history
  await db.from("entry_history").insert({
    entry_id: existing.id,
    content: existing.content,
    source: existing.source,
  });

  // Restore old content
  const { data, error } = await db
    .from("entries")
    .update({ content: historyRecord.content, source: "human" })
    .eq("id", existing.id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  return data as Entry;
}
