import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";

/**
 * Renders a `## Sync error` markdown section for the SessionStart brief when
 * the daemon's previous flush attempt hit a cap or other actionable error.
 *
 * Source: `~/.synapse/sync-errors.json`, written by handoff-sync.ts when
 * `POST /api/events/batch` returns 402 PROJECT_QUOTA_EXCEEDED (or future
 * structured failures). Entries older than 24h are pruned at render time.
 *
 * Returns "" on:
 *   - no errors file
 *   - all entries >24h old (stale; the user has had a chance to act)
 *   - file unparseable (corrupted JSON — fail closed)
 *
 * This is deliberately a brief-time render rather than a daemon-time push,
 * so a user who's at-cap sees the error in EVERY session start until they
 * either delete a project or 24h passes (the latter is a safety valve so
 * stale errors don't haunt the brief forever).
 */
interface SyncErrorEntry {
  code: string;
  at: string;
  detail?: string;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function pullSyncErrorsSection(): string {
  const file = path.join(synapseRoot(), "sync-errors.json");
  if (!fs.existsSync(file)) return "";

  let data: { errors?: SyncErrorEntry[] };
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8")) as { errors?: SyncErrorEntry[] };
  } catch {
    return "";
  }

  const now = Date.now();
  const recent = (data.errors ?? []).filter((e) => {
    const t = new Date(e.at).getTime();
    return Number.isFinite(t) && now - t < MAX_AGE_MS;
  });
  if (recent.length === 0) return "";

  const lines: string[] = ["## Sync error"];
  // Dedupe by code — if the user has 5 entries for PROJECT_QUOTA_EXCEEDED,
  // they only need to see one message. The detail (if any) from the most
  // recent entry wins.
  const seen = new Set<string>();
  for (const e of recent.slice().reverse()) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    lines.push(renderEntry(e));
  }
  return lines.join("\n");
}

function renderEntry(e: SyncErrorEntry): string {
  if (e.code === "PROJECT_QUOTA_EXCEEDED") {
    return "- **Could not auto-create a new project**: you have 50 of 50 projects. Delete one in the dashboard to continue capturing new repos.";
  }
  // Generic fallback for future error codes
  return `- Sync error (${e.code})${e.detail ? `: ${e.detail}` : ""}`;
}
