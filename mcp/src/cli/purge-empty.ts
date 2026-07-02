import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "./config.js";
import { traceFetch } from "./util/trace-fetch.js";

/**
 * `synapsesync purge-empty` — bulk-delete every project owned by the
 * authenticated user that has zero conversations AND zero insights.
 *
 * Use case: the dashboard accumulates orphan "untitled" placeholders and
 * test artifacts over time. Pre-launch, those balloon the projects table
 * and consume tier quota. This command is the cleanup tool. It defers
 * to the backend's safety check (DELETE refuses non-empty without
 * ?force=true) so a stale local view can't accidentally drop real data.
 *
 * Args:
 *   --yes        Actually perform the deletes. Default is dry-run.
 *   --include-named <pattern>  Also delete empty projects matching the
 *                              substring (e.g. `--include-named synapse-e2e-test`).
 *                              Without this, only `untitled` projects are
 *                              candidates — narrower default protects from
 *                              accidentally nuking a real but empty project
 *                              like `get-shit-done` before any captures land.
 */

export interface PurgeEmptyArgs {
  yes: boolean;
  includeNamed?: string;
}

interface SynapseConfig {
  api_key?: string;
}

interface ProjectListItem {
  id: string;
  name: string;
  conversation_count?: number;
  insight_count?: number;
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

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function listProjects(apiKey: string): Promise<ProjectListItem[]> {
  const res = await traceFetch("purge:list", `${API_URL}/api/projects`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`GET /api/projects → ${res.status}`);
  return (await res.json()) as ProjectListItem[];
}

async function deleteProject(apiKey: string, projectId: string): Promise<void> {
  const res = await traceFetch("purge:delete", `${API_URL}/api/projects/${projectId}`, {
    method: "DELETE",
    headers: authHeaders(apiKey),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DELETE /api/projects/${projectId} → ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Identify which of the user's projects are eligible for purge — empty
 * AND match the name filter (default: only `untitled`). Pure-ish: pulls
 * from the live API but doesn't mutate anything. The returned list is
 * what the CLI prints in dry-run mode and iterates over with --yes.
 */
export function selectPurgeCandidates(
  projects: ProjectListItem[],
  opts: { includeNamed?: string } = {},
): ProjectListItem[] {
  return projects.filter((p) => {
    const isEmpty = (p.conversation_count ?? 0) === 0 && (p.insight_count ?? 0) === 0;
    if (!isEmpty) return false;
    if (opts.includeNamed) return p.name.includes(opts.includeNamed);
    return p.name === "untitled";
  });
}

export async function runPurgeEmptyCmd(args: PurgeEmptyArgs): Promise<void> {
  const apiKey = readApiKey();
  const projects = await listProjects(apiKey);
  const candidates = selectPurgeCandidates(projects, { includeNamed: args.includeNamed });

  if (candidates.length === 0) {
    process.stdout.write("No empty projects matched the filter — nothing to purge.\n");
    return;
  }

  const verb = args.yes ? "Deleting" : "Would delete (dry-run, pass --yes to actually delete)";
  process.stdout.write(`${verb} ${candidates.length} empty project(s):\n`);
  for (const p of candidates) {
    process.stdout.write(`  ${p.id}  ${p.name}\n`);
  }

  if (!args.yes) return;

  let succeeded = 0;
  const failed: { id: string; name: string; error: string }[] = [];
  for (const p of candidates) {
    try {
      await deleteProject(apiKey, p.id);
      succeeded += 1;
    } catch (err) {
      failed.push({ id: p.id, name: p.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  process.stdout.write(`\nDeleted ${succeeded} of ${candidates.length}.\n`);
  if (failed.length > 0) {
    process.stdout.write(`Failed (${failed.length}):\n`);
    for (const f of failed) {
      process.stdout.write(`  ${f.id} (${f.name}): ${f.error}\n`);
    }
  }
}
