import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import { getEntry, upsertEntry } from "../db/queries";

interface ParsedEntry {
  path: string;
  content: string;
  content_type: "markdown" | "json";
  tags: string[];
  source: string;
}

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const fm: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse array: [tag1, tag2]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    fm[key] = value;
  }

  return { frontmatter: fm, content: match[2] };
}

export function parseZipEntries(zipData: Uint8Array): { meta: Record<string, unknown>; entries: ParsedEntry[] } {
  const files = unzipSync(zipData);
  let meta: Record<string, unknown> = {};
  const entries: ParsedEntry[] = [];

  for (const [path, data] of Object.entries(files)) {
    const content = strFromU8(data);

    if (path === "_synapse_meta.json") {
      meta = JSON.parse(content);
      continue;
    }

    // Skip directories (fflate may include empty dir entries)
    if (path.endsWith("/")) continue;

    try {
      if (path.endsWith(".json")) {
        const entryPath = path.replace(/\.json$/, "");
        entries.push({
          path: entryPath,
          content,
          content_type: "json",
          tags: [],
          source: "human",
        });
      } else {
        const entryPath = path.replace(/\.md$/, "");
        const { frontmatter, content: body } = parseFrontmatter(content);
        entries.push({
          path: entryPath,
          content: body,
          content_type: (frontmatter.content_type as "markdown" | "json") ?? "markdown",
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
          source: (frontmatter.source as string) ?? "human",
        });
      }
    } catch {
      // Skip unparseable files — counted as skipped
    }
  }

  return { meta, entries };
}

export async function importEntries(
  db: SupabaseClient,
  projectId: string,
  entries: ParsedEntry[],
  authorId: string,
): Promise<ImportResult> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      const existing = await getEntry(db, projectId, entry.path);

      await upsertEntry(db, {
        project_id: projectId,
        path: entry.path,
        content: entry.content,
        content_type: entry.content_type,
        tags: entry.tags,
        source: entry.source,
        author_id: authorId,
      });

      if (existing) {
        updated++;
      } else {
        imported++;
      }
    } catch {
      skipped++;
    }
  }

  return { imported, updated, skipped };
}
