import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectMapping {
  project_id: string;
  project_name: string;
  updated_at: string;
}

export type ProjectMap = Record<string, ProjectMapping>;

export function getProjectMapPath(): string {
  // Respect SYNAPSE_HOME so tests can redirect ~/.synapse to a tmp dir
  // without leaking real project mappings into the test process.
  const root = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  return path.join(root, "project-map.json");
}

export function readProjectMap(): ProjectMap {
  try {
    const raw = fs.readFileSync(getProjectMapPath(), "utf-8");
    return JSON.parse(raw) as ProjectMap;
  } catch {
    return {};
  }
}

export function upsertProjectMapping(cwd: string, entry: { project_id: string; project_name: string }): void {
  const p = getProjectMapPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const map = readProjectMap();
  map[cwd] = { ...entry, updated_at: new Date().toISOString() };
  fs.writeFileSync(p, JSON.stringify(map, null, 2));
}

/**
 * Drop a cwd's project mapping. Best-effort, idempotent. Used when a sync
 * (or pull-compact) discovers the cached project_id is dead server-side
 * (e.g., user ran `synapse reset` or deleted the project from the
 * dashboard).
 *
 * Two delete modes:
 *
 * (1) **Targeted (projectIdHint supplied)**: remove ALL entries pointing
 *     at that project_id, regardless of which `cwd` key stores them.
 *     Solves the dual-key case where the same cwd can appear in the map
 *     under multiple keys — typically `/tmp/foo` AND `/private/tmp/foo`
 *     on macOS because different code paths canonicalize differently.
 *     Without sweeping by value, pull-compact's 404 invalidation was
 *     dead-letter for the lookup-key-vs-stored-key mismatch case:
 *     entries lingered forever pointing to deleted projects, the same
 *     stale entry would 404 every cycle.
 *
 * (2) **Untargeted (no hint)**: remove just the literal `cwd` key.
 *     Preserves the original "the caller is explicitly forgetting this
 *     mapping" semantics for non-pull-compact callers.
 */
export function removeProjectMapping(cwd: string, projectIdHint?: string): void {
  try {
    const p = getProjectMapPath();
    if (!fs.existsSync(p)) return;
    const map = readProjectMap();

    let removed = 0;
    if (projectIdHint) {
      // Targeted sweep: drop every entry pointing at the dead project_id.
      for (const key of Object.keys(map)) {
        if (map[key].project_id === projectIdHint) {
          delete map[key];
          removed++;
        }
      }
    } else if (map[cwd]) {
      delete map[cwd];
      removed = 1;
    }

    if (removed > 0) {
      fs.writeFileSync(p, JSON.stringify(map, null, 2));
    }
  } catch {
    /* best-effort cache — never throw from here */
  }
}
