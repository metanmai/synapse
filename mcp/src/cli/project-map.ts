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
