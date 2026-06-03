import fs from "node:fs";
import path from "node:path";
import { readProjectMap } from "../cli/project-map.js";
import { synapseRoot } from "./handoff-paths.js";

const API_URL = "https://api.synapsesync.app";
const MAX_INSIGHTS = 10;
const FETCH_TIMEOUT_MS = 3000;

interface InsightRow {
  id: string;
  type: string;
  summary: string;
  detail: string | null;
}

/**
 * Fetch recent insights for the project at `cwd` and render them as a
 * markdown section for inclusion in the SessionStart brief. Returns "" on
 * any failure — never throws. The brief degrades to no-insights if
 * anything is wrong, which is safer than blocking session start.
 *
 * Project resolution: relies on the local project-map cache (populated by
 * `pullHandoffWithTimeout` upstream in the same hook). If the map has no
 * entry for the cwd, returns "" — first-ever session on a new device sees
 * no insights, but the next session does once the cache warms.
 *
 * Why this exists: save_insight writes to the backend, list_insights and
 * the dashboard can read them, but until this helper, the SessionStart
 * brief had no path to pull them in. Cross-session insight transfer
 * happened only when an agent explicitly called list_insights, which
 * agents rarely do unprompted. This closes the loop.
 */
export async function pullInsightsSection(cwd: string): Promise<string> {
  const projectId = resolveProjectId(cwd);
  if (!projectId) return "";

  const apiKey = readApiKey();
  if (!apiKey) return "";

  const insights = await fetchInsights(projectId, apiKey);
  if (insights.length === 0) return "";

  return renderSection(insights);
}

function resolveProjectId(cwd: string): string | undefined {
  const map = readProjectMap();
  try {
    const canonical = fs.realpathSync(cwd);
    return map[canonical]?.project_id ?? map[cwd]?.project_id;
  } catch {
    return map[cwd]?.project_id;
  }
}

function readApiKey(): string | undefined {
  if (process.env.SYNAPSE_API_KEY) return process.env.SYNAPSE_API_KEY;
  const configPath = path.join(synapseRoot(), "config.json");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { api_key?: string };
    return cfg.api_key;
  } catch {
    return undefined;
  }
}

async function fetchInsights(projectId: string, apiKey: string): Promise<InsightRow[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const url = `${API_URL}/api/insights?project_id=${encodeURIComponent(projectId)}&limit=${MAX_INSIGHTS}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const body = (await res.json()) as { insights?: InsightRow[] } | InsightRow[];
    const rows = Array.isArray(body) ? body : (body.insights ?? []);
    return rows;
  } catch {
    return [];
  }
}

function renderSection(insights: InsightRow[]): string {
  const lines: string[] = ["## Recent insights"];
  for (const row of insights.slice(0, MAX_INSIGHTS)) {
    const summary = (row.summary ?? "").trim();
    if (!summary) continue;
    const type = (row.type ?? "note").trim();
    lines.push(`- [${type}] ${summary}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
