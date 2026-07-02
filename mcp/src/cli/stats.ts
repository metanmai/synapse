import * as clack from "@clack/prompts";
import { validateApiKey } from "./api.js";
import { API_URL, pad } from "./config.js";
import { detectExistingSetup } from "./editors/index.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success, error as themeError } from "./theme.js";

interface ProjectResponse {
  id: string;
  name: string;
  created_at: string;
  role: string;
}

interface EntryListItem {
  path: string;
  updated_at: string;
  tags: string[];
}

interface ActivityEntry {
  action: string;
  source: string;
  target_path: string | null;
  created_at: string;
}

async function apiFetch<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

export async function runStats(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Stats")}`);

  // Find API key
  const existing = detectExistingSetup();
  if (existing.apiKeys.length === 0) {
    clack.log.error("No API key found. Run the setup wizard first:");
    clack.log.message(`  ${accent("synapsesync wizard")}`);
    process.exit(1);
  }

  // Validate keys — find a working one
  const spin = createGlyphSpinner();
  spin.start("Connecting\u2026");

  let apiKey: string | null = null;
  let fallback: string | null = null;
  for (const key of existing.apiKeys) {
    const status = await validateApiKey(key);
    if (status.status === "valid") {
      apiKey = key;
      break;
    }
    // "unknown" = transient (slow /api/projects, timeout, 429, 5xx) — NOT a
    // confirmed auth failure. Proceed with it rather than mis-reporting a
    // working key as expired; the fetches below surface any real error.
    if (status.status === "unknown" && !fallback) fallback = key;
  }
  if (!apiKey) apiKey = fallback;

  if (!apiKey) {
    // Only reached when every key was a CONFIRMED auth failure (401 + code).
    spin.stop(themeError("API key expired or invalid"));
    clack.log.error("Sign in again:");
    clack.log.message(`  ${accent("synapsesync wizard")}`);
    process.exit(1);
  }

  // Fetch workspace data
  spin.update("Fetching workspace\u2026");
  const projects = await apiFetch<ProjectResponse[]>(apiKey, "/api/projects");
  if (projects.length === 0) {
    spin.stop("No workspace yet.");
    clack.outro(muted("Create your workspace at synapsesync.app"));
    return;
  }

  // Iterate projects until we find one whose context endpoint resolves.
  // `/api/projects` and `/api/context/<name>` can diverge in real-world
  // workflows: a project deleted via purge-empty, a rename mid-flight, or
  // a backend consistency lag can leave a project listed but its context
  // lookup 404s. Without this loop, stats crashes on the first such row
  // \u2014 a brittle behavior that surfaced on metanmai CI run 27120098811
  // (Error: API 404: {"error":"Project not found","code":"NOT_FOUND"}).
  let project: ProjectResponse | null = null;
  let entries: EntryListItem[] = [];
  spin.update("Fetching files\u2026");
  for (const candidate of projects) {
    try {
      entries = await apiFetch<EntryListItem[]>(apiKey, `/api/context/${encodeURIComponent(candidate.name)}/list`);
      project = candidate;
      break;
    } catch (err) {
      // Only fall through on 404. Other errors (5xx, auth) should still
      // surface to the user so they don't silently see partial stats.
      if (err instanceof Error && err.message.startsWith("API 404")) continue;
      throw err;
    }
  }
  if (!project) {
    spin.stop("No accessible workspace.");
    clack.outro(muted("Your projects are in a transient state \u2014 try again in a moment."));
    return;
  }

  const tagCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const actionCounts: Record<string, number> = {};
  let oldestDate: string | null = null;
  let newestDate: string | null = null;

  for (const entry of entries) {
    for (const tag of entry.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    if (!oldestDate || entry.updated_at < oldestDate) oldestDate = entry.updated_at;
    if (!newestDate || entry.updated_at > newestDate) newestDate = entry.updated_at;
  }

  spin.update("Fetching activity\u2026");
  const activity = await apiFetch<ActivityEntry[]>(
    apiKey,
    `/api/projects/${encodeURIComponent(project.id)}/activity?limit=500`,
  );

  for (const a of activity) {
    actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
    if (a.source) sourceCounts[a.source] = (sourceCounts[a.source] || 0) + 1;
  }

  spin.stop(`${success("\u2713")} Data loaded`);

  // --- Display ---

  const accountAge = Math.floor((Date.now() - new Date(project.created_at).getTime()) / 86_400_000);
  const LW = 22;

  // Overview
  clack.log.message(
    [
      `${pad(muted("Account age"), LW)} ${bold(String(accountAge))} days`,
      `${pad(muted("Total files"), LW)} ${bold(String(entries.length))}`,
      `${pad(muted("Activity events"), LW)} ${bold(String(activity.length))}`,
    ].join("\n"),
  );

  // Activity breakdown
  const actionLabels: Record<string, string> = {
    entry_created: "Files created",
    entry_updated: "Files updated",
    entry_deleted: "Files deleted",
    member_added: "Members added",
    member_removed: "Members removed",
    share_link_created: "Links shared",
    share_link_revoked: "Links revoked",
    settings_changed: "Settings changed",
  };
  const sortedActions = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]);
  if (sortedActions.length > 0) {
    const lines = sortedActions.map(([action, count]) => {
      const label = actionLabels[action] || action;
      return `  ${pad(muted(label), LW)} ${accent(String(count))}`;
    });
    clack.log.message(`${bold("Activity")}\n${lines.join("\n")}`);
  }

  // Sources
  const sourceTotal = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
  const sortedSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);
  if (sortedSources.length > 0) {
    const lines = sortedSources.map(([source, count]) => {
      return `  ${pad(muted(source), LW)} ${accent(String(count))}  ${muted(pct(count, sourceTotal))}`;
    });
    clack.log.message(`${bold("Sources")}\n${lines.join("\n")}`);
  }

  // Tags
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  if (sortedTags.length > 0) {
    const top = sortedTags.slice(0, 8);
    const lines = top.map(([tag, count]) => {
      return `  ${pad(muted(tag), LW)} ${accent(String(count))} files`;
    });
    if (sortedTags.length > 8) {
      lines.push(`  ${muted(`\u2026 and ${sortedTags.length - 8} more`)}`);
    }
    clack.log.message(`${bold("Tags")}  ${muted(`(${sortedTags.length} unique)`)}\n${lines.join("\n")}`);
  }

  // Timeline
  if (oldestDate && newestDate) {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    clack.log.message(
      `${bold("Timeline")}\n` +
        `  ${pad(muted("First file"), LW)} ${fmt(oldestDate)}\n` +
        `  ${pad(muted("Latest file"), LW)} ${fmt(newestDate)}`,
    );
  }

  clack.outro(muted("synapsesync.app"));
}
