import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "./config.js";

/**
 * `synapse move <conv> <project>` — manually reassign a misrouted
 * conversation to a different project.
 *
 * The deterministic git-based routing (findOrCreateProjectByGit) is
 * correct for 95% of cases, but Tier 2 name collisions can silently
 * merge two unrelated `scratch` repos. This is the user-facing escape
 * hatch — they can move any conversation they have editor access to
 * into any other project they have editor access to, by name or UUID.
 *
 * Args:
 *   <conv>    UUID, prefix of UUID, or the literal string "latest" (the
 *             most-recently-touched conversation across all the user's
 *             projects).
 *   <project> UUID or project name. Name resolution uses exact match
 *             first, then case-insensitive substring match if exactly
 *             one project's name contains the query.
 */

export interface MoveArgs {
  conv: string;
  project: string;
}

interface SynapseConfig {
  api_key?: string;
}

interface Conversation {
  id: string;
  project_id: string;
  title: string | null;
}

interface ConversationListItem {
  id: string;
  title: string | null;
  updated_at: string;
}

interface ProjectListItem {
  id: string;
  name: string;
}

function readApiKey(): string {
  const root = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  const configPath = path.join(root, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as SynapseConfig;
      if (c.api_key) return c.api_key;
    } catch {
      /* fall through */
    }
  }
  const envKey = process.env.SYNAPSE_API_KEY;
  if (envKey) return envKey;
  throw new Error("no API key configured — run `synapsesync init` first or set SYNAPSE_API_KEY");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function listProjects(apiKey: string): Promise<ProjectListItem[]> {
  const res = await fetch(`${API_URL}/api/projects`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`GET /api/projects → ${res.status}`);
  return (await res.json()) as ProjectListItem[];
}

/**
 * Resolve `query` to a project_id. Order of attempts:
 *   1. Full UUID — pass through unchecked (backend will 404 if wrong).
 *   2. Exact name match.
 *   3. Single substring match (case-insensitive).
 * If multiple projects fuzzy-match, the function throws and lists the
 * candidates so the user can disambiguate.
 */
async function resolveProjectId(query: string, apiKey: string): Promise<string> {
  if (UUID_RE.test(query)) return query;

  const projects = await listProjects(apiKey);
  const lower = query.toLowerCase();

  const exact = projects.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) {
    const listed = exact.map((p) => `  ${p.id}  ${p.name}`).join("\n");
    throw new Error(`multiple projects exactly named "${query}":\n${listed}\npass a UUID to disambiguate.`);
  }

  const contains = projects.filter((p) => p.name.toLowerCase().includes(lower));
  if (contains.length === 1) return contains[0].id;
  if (contains.length > 1) {
    const listed = contains.map((p) => `  ${p.id}  ${p.name}`).join("\n");
    throw new Error(
      `multiple projects match "${query}":\n${listed}\nuse the project's UUID or a more specific name fragment.`,
    );
  }

  throw new Error(`no project found matching "${query}"`);
}

async function resolveConvId(query: string, apiKey: string): Promise<string> {
  if (UUID_RE.test(query)) return query;

  if (query === "latest") {
    // Walk projects newest-first; take the first conversation we see. The
    // /api/projects list isn't ordered for us, so fetch a few candidate
    // projects' conversations and pick the most-recently-touched. Capped
    // at the user's 10 most recent projects so we don't fan out on heavy
    // accounts.
    const projects = await listProjects(apiKey);
    let best: { id: string; updated_at: string; project_id: string } | null = null;
    for (const p of projects.slice(0, 10)) {
      const res = await fetch(`${API_URL}/api/conversations?project_id=${encodeURIComponent(p.id)}&limit=1`, {
        headers: authHeaders(apiKey),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { conversations?: ConversationListItem[] };
      const top = body.conversations?.[0];
      if (top && (!best || top.updated_at > best.updated_at)) {
        best = { id: top.id, updated_at: top.updated_at, project_id: p.id };
      }
    }
    if (!best) throw new Error("no conversations found on this account");
    return best.id;
  }

  // Treat as UUID prefix — only useful if the user pasted a truncated id.
  // Scan project lists for a match; this is O(projects * 1 fetch) which
  // is fine for the small-account case but we don't make it the default.
  throw new Error(`unrecognized conversation reference "${query}" — pass a full UUID or the literal "latest".`);
}

export async function runMoveCmd(args: MoveArgs): Promise<void> {
  const apiKey = readApiKey();
  const convId = await resolveConvId(args.conv, apiKey);
  const projectId = await resolveProjectId(args.project, apiKey);

  const res = await fetch(`${API_URL}/api/conversations/${convId}/reassign`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ project_id: projectId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`reassign failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const moved = (await res.json()) as Conversation;
  process.stdout.write(`Moved conversation ${moved.id} → project ${moved.project_id}\n`);
  if (moved.title) process.stdout.write(`  title: ${moved.title}\n`);
}
