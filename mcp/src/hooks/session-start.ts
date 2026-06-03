import fs from "node:fs";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { briefCachePath, currentSessionPath, projectDir } from "../capture/handoff-paths.js";
import { pullHandoffWithTimeout } from "../capture/pull-compact.js";
import { pullInsightsSection } from "../capture/pull-insights.js";
import { pullSyncErrorsSection } from "../capture/pull-sync-errors.js";
import { canonicalCwd } from "../cli/hook-dispatch.js";

const PULL_HANDOFF_TIMEOUT_MS = 10_000;

const MAX_BRIEF_LINES = 30;

export interface SessionStartArgs {
  project_id: string;
  user_id: string;
  stdout: NodeJS.WriteStream;
  skipFallback?: boolean;
  git_basename?: string;
  git_remote_url?: string;
  cwd?: string;
}

export async function runSessionStartHook(args: SessionStartArgs): Promise<void> {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const session_id = `s_${Date.now().toString(36)}`;
  const actor = resolveActor(args.user_id, "human", "claude-code");

  let brief = "";
  const bp = briefCachePath(args.project_id);
  // Two cwd variants flow through this hook:
  //  - rawCwd: what the dispatcher / caller handed us. Used as the routing
  //    key when looking things up in caches written by old clients (which
  //    didn't canonicalize before storing). pull-compact also accepts the
  //    raw form and canonicalizes internally with its own fallback chain.
  //  - cwd: the canonical (realpath-resolved) version. Used for local
  //    filesystem checks like STATE.md lookup — those should follow
  //    symlinks transparently.
  const rawCwd = args.cwd ?? process.cwd();
  const cwd = canonicalCwd(rawCwd);
  if (shouldPreferStateMd(bp, cwd)) {
    // STATE.md is the canonical project-state artifact (GSD convention).
    // When the daemon's brief cache is missing or older than STATE.md, the repo
    // already has fresher context than what the daemon would emit — surface it.
    brief = readStateMdSlice(cwd) ?? "";
  } else if (fs.existsSync(bp)) {
    brief = fs.readFileSync(bp, "utf-8");
  } else if (!args.skipFallback) {
    brief = `Project: ${args.project_id}\n(no cached context — daemon will populate on next sync)`;
  }

  // Pull the most-recent conversation's "where I left off" handoff so the
  // new agent inherits the previous one's working memory. Capped at a
  // 10s wall-clock — if compaction would take longer than that we'd
  // visibly stall the hook stdout, so we let the slow path complete in
  // background and the next session picks it up from the backend cache.
  let handoff: string | null = null;
  try {
    // Pass the RAW cwd — pull-compact does its own realpath with a
    // fallback chain (canonical → raw), so caches written by older
    // clients under the raw key still resolve.
    handoff = await pullHandoffWithTimeout({ cwd: rawCwd }, PULL_HANDOFF_TIMEOUT_MS);
  } catch {
    handoff = null;
  }

  // Pull recent insights AFTER pullHandoff (which warms the project-map
  // cache via Tier 2 routing) so the cwd → project_id lookup hits the
  // local map. Best-effort: any failure falls through to no-insights
  // rather than blocking the hook output.
  let insightsSection = "";
  try {
    insightsSection = await pullInsightsSection(rawCwd);
  } catch {
    insightsSection = "";
  }

  // Phase 03-02: render any cached daemon sync errors (PROJECT_QUOTA_EXCEEDED
  // etc.) so the next AI session sees an actionable note about why captures
  // aren't reaching the backend. Synchronous + filesystem-only — never throws.
  const syncErrorsSection = pullSyncErrorsSection();

  const parts = [brief.trim()];
  if (insightsSection) parts.push(insightsSection);
  if (handoff) parts.push(`## Last conversation handoff\n\n${handoff.trim()}`);
  // Sync errors go LAST so they're the most prominent — they require user
  // action and shouldn't be buried above unrelated insights/handoff.
  if (syncErrorsSection) parts.push(syncErrorsSection);
  const composed = parts.join("\n\n");
  args.stdout.write(`<synapse-brief>\n${composed}\n</synapse-brief>\n`);

  appendEvent(projectDir(args.project_id), {
    project_id: args.project_id,
    session_id,
    actor,
    attached_to: null,
    kind: EventKind.SessionOpened,
    occurred_at: new Date().toISOString(),
    payload: {
      hostname: actor.hostname,
      ...(args.git_basename ? { git_basename: args.git_basename } : {}),
      ...(args.git_remote_url ? { git_remote_url: args.git_remote_url } : {}),
    },
  });

  fs.mkdirSync(projectDir(args.project_id), { recursive: true });
  fs.writeFileSync(
    currentSessionPath(args.project_id),
    JSON.stringify({ session_id, started_at: new Date().toISOString() }),
  );
}

function shouldPreferStateMd(briefCache: string, cwd: string): boolean {
  const stateMd = path.join(cwd, ".planning/STATE.md");
  if (!fs.existsSync(stateMd)) return false;
  if (!fs.existsSync(briefCache)) return true;
  return fs.statSync(stateMd).mtimeMs > fs.statSync(briefCache).mtimeMs;
}

function readStateMdSlice(cwd: string): string | null {
  const stateMd = path.join(cwd, ".planning/STATE.md");
  if (!fs.existsSync(stateMd)) return null;
  const lines = fs.readFileSync(stateMd, "utf-8").split("\n");
  return lines.slice(0, MAX_BRIEF_LINES).join("\n");
}
