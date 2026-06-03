import { execSync } from "node:child_process";
import { readProjectMap } from "./project-map.js";

export interface ResolvedProject {
  source: "local" | "backend" | "workspace_fallback";
  project_id: string | null;
  name: string | null;
}

export interface BackendResolveResponse {
  project_id: string | null;
  name: string | null;
  confidence: string | null;
  signal: string;
}

export type BackendResolveFn = (signals: {
  cwd: string;
  git_origin_url?: string;
  git_basename?: string;
}) => Promise<BackendResolveResponse>;

function readGitSignals(cwd: string): { git_origin_url?: string; git_basename?: string } {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const match = url.match(/[/:]([^/:]+?)(?:\.git)?$/);
    return {
      git_origin_url: url || undefined,
      git_basename: match?.[1],
    };
  } catch {
    return {};
  }
}

export async function resolveProject(cwd: string, backend: BackendResolveFn): Promise<ResolvedProject> {
  // 1. Local map — fastest, works offline
  const map = readProjectMap();
  const local = map[cwd];
  if (local && typeof local.project_id === "string" && typeof local.project_name === "string") {
    return { source: "local", project_id: local.project_id, name: local.project_name };
  }

  // 2. Backend resolve
  const signals = readGitSignals(cwd);
  try {
    const res = await backend({ cwd, ...signals });
    if (res.project_id) {
      return { source: "backend", project_id: res.project_id, name: res.name };
    }
  } catch {
    /* network/auth issue — fall through to workspace fallback */
  }

  // 3. Workspace fallback
  return { source: "workspace_fallback", project_id: null, name: null };
}
