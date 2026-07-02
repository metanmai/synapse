import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry, EntryHistory } from "../types";
import { singleOrNull } from "../query-helpers";

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
  }
): Promise<Entry> {
  // Check if entry exists at this path
  const { data: existing } = await db
    .from("entries")
    .select("*")
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
      .select()
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
    .select()
    .single();
  if (error) throw error;
  return data as Entry;
}

export async function getEntry(
  db: SupabaseClient,
  projectId: string,
  path: string
): Promise<Entry | null> {
  return singleOrNull<Entry>(
    await db
      .from("entries")
      .select("*")
      .eq("project_id", projectId)
      .eq("path", path)
      .single()
  );
}

export async function listEntries(
  db: SupabaseClient,
  projectId: string,
  folder?: string
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
  options?: { tags?: string[]; folder?: string }
): Promise<Entry[]> {
  // Use Postgres full-text search
  let dbQuery = db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .textSearch("search_vector", query, { type: "websearch" });

  if (options?.folder) {
    dbQuery = dbQuery.like("path", `${options.folder}/%`);
  }

  if (options?.tags?.length) {
    dbQuery = dbQuery.overlaps("tags", options.tags);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function getRecentEntries(
  db: SupabaseClient,
  projectId: string,
  limit: number = 20
): Promise<Entry[]> {
  const { data, error } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function getAllEntries(
  db: SupabaseClient,
  projectId: string
): Promise<Entry[]> {
  const { data, error } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .order("path", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function countEntries(
  db: SupabaseClient,
  projectId: string
): Promise<number> {
  const { count, error } = await db
    .from("entries")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) throw error;
  return count ?? 0;
}

export async function countUniqueConnections(
  db: SupabaseClient,
  projectId: string
): Promise<number> {
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

export async function deleteEntry(
  db: SupabaseClient,
  projectId: string,
  path: string
): Promise<void> {
  const { error } = await db
    .from("entries")
    .delete()
    .eq("project_id", projectId)
    .eq("path", path);
  if (error) throw error;
}

export async function getEntryHistory(
  db: SupabaseClient,
  projectId: string,
  path: string
): Promise<EntryHistory[]> {
  // First get the entry ID
  const { data: entry } = await db
    .from("entries")
    .select("id")
    .eq("project_id", projectId)
    .eq("path", path)
    .single();

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
  historyId: string
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
  const { data: existing } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .eq("path", path)
    .single();

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
    .select()
    .single();
  if (error) throw error;
  return data as Entry;
}
