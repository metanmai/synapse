import { zipSync, strToU8 } from "fflate";
import type { Entry } from "../db/types";

function buildFrontmatter(entry: Entry): string {
  const lines: string[] = ["---"];
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`tags: [${entry.tags.join(", ")}]`);
  }
  if (entry.source) {
    lines.push(`source: ${entry.source}`);
  }
  lines.push(`content_type: ${entry.content_type || "markdown"}`);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export function buildProjectZip(
  projectName: string,
  entries: Entry[]
): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  // Add metadata file
  const meta = JSON.stringify({
    version: 1,
    project_name: projectName,
    exported_at: new Date().toISOString(),
    entry_count: entries.length,
  }, null, 2);
  files["_synapse_meta.json"] = strToU8(meta);

  // Add each entry as a file
  for (const entry of entries) {
    if (entry.content_type === "json") {
      const path = entry.path.endsWith(".json") ? entry.path : `${entry.path}.json`;
      files[path] = strToU8(entry.content);
    } else {
      const path = entry.path.endsWith(".md") ? entry.path : `${entry.path}.md`;
      const frontmatter = buildFrontmatter(entry);
      files[path] = strToU8(frontmatter + entry.content);
    }
  }

  return zipSync(files);
}
