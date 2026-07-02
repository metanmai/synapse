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
 * dashboard). If projectIdHint is supplied, only drops the entry when
 * the stored project_id matches — protects against racing writes that
 * may have rebound the cwd to a fresh project_id in between.
 */
export function removeProjectMapping(cwd: string, projectIdHint?: string): void {
  try {
    const p = getProjectMapPath();
    if (!fs.existsSync(p)) return;
    const map = readProjectMap();
    if (!map[cwd]) return;
    if (projectIdHint && map[cwd].project_id !== projectIdHint) return;
    delete map[cwd];
    fs.writeFileSync(p, JSON.stringify(map, null, 2));
  } catch {
    /* best-effort cache — never throw from here */
  }
}
