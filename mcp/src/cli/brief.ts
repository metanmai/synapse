import { formatBrief, formatWorkspaceBrief } from "./brief-format.js";
import { API_URL } from "./config.js";
import { type BackendResolveFn, resolveProject } from "./resolve-project.js";

interface SessionContextResponse {
  project_id: string;
  summary: string | null;
  summary_source: string | null;
  summary_updated_at: string | null;
  recent_conversations: Array<{
    id: string;
    title: string | null;
    compacted_summary: string | null;
    compacted_at: string;
  }>;
  insights: Array<{
    type: "decision" | "learning" | "preference" | "architecture" | "action_item";
    summary: string;
    detail: string | null;
    updated_at: string;
  }>;
}

interface WorkspaceRecentResponse {
  projects: Array<{ id: string; name: string; updated_at: string }>;
}

async function api<T>(method: string, path: string, key: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function runBrief(_args: string[]): Promise<void> {
  const key = process.env.SYNAPSE_API_KEY;
  if (!key) {
    // Silent: don't pollute stdout with errors that get piped into agents
    return;
  }

  const cwd = process.cwd();

  const backendResolve: BackendResolveFn = (signals) => api("POST", "/api/projects/resolve", key, signals);

  const resolved = await resolveProject(cwd, backendResolve);
  const now = new Date();

  if (resolved.project_id) {
    try {
      const ctx = await api<SessionContextResponse>(
        "GET",
        `/api/projects/${encodeURIComponent(resolved.project_id)}/session-context`,
        key,
      );
      process.stdout.write(
        formatBrief({
          project: { name: resolved.name ?? "(unknown)" },
          summary: ctx.summary,
          summary_updated_at: ctx.summary_updated_at,
          recent_conversations: ctx.recent_conversations,
          insights: ctx.insights,
          now,
        }),
      );
      return;
    } catch {
      /* fall through to workspace fallback on error */
    }
  }

  // Workspace-level fallback
  try {
    const ws = await api<WorkspaceRecentResponse>("GET", "/api/workspace/recent-projects", key);
    process.stdout.write(formatWorkspaceBrief({ projects: ws.projects, now }));
  } catch {
    // Silent failure: emit an empty but valid brief so the hook doesn't error
    process.stdout.write(formatWorkspaceBrief({ projects: [], now }));
  }
}
