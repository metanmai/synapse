/**
 * `synapsesync sync` — manual one-shot sync command (Phase 03-05).
 *
 * Why this exists: on Free, the daemon's 5-min auto-sync cycle is
 * gated off (see daemon.ts tier-gate). Hooks (SessionEnd, PreCompact)
 * still push inline at session boundaries, but cross-session +
 * cross-device continuity needs a kick. `synapsesync sync` is that
 * kick — fires one full flush+pull cycle on demand against the live
 * backend, with streaming progress per step + a final summary line.
 *
 * On Plus, `sync` is also available — useful as a debug tool to force
 * a sync without waiting for the next cron tick.
 *
 * Streaming output matches the `doctor --smoke` shape: print step on
 * start, then completion + detail on the same line when done.
 *
 * Exit 0 on full success, 1 if any step had an error (best-effort —
 * we still try the remaining steps before exiting).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEvents } from "../capture/events-log.js";
import { projectDir, synapseRoot } from "../capture/handoff-paths.js";
import { runFlushCycle, runPullCycle } from "../capture/handoff-sync.js";
import { readProjectMap } from "./project-map.js";

/**
 * Union of project ids known to the map AND project dirs present on disk.
 *
 * The map alone is NOT enough: a first-contact cwd's placeholder queue
 * (`projects/cwd_<hash>/events.jsonl`, written by hook-dispatch before any
 * backend round-trip) has no map entry yet — map entries appear only after
 * a successful sync or resolve. A map-only listing therefore silently
 * skipped exactly the queues that most need the manual kick, leaving
 * first-contact events stranded until the daemon's next projects-dir
 * re-scan (~minutes). Mirrors the daemon's reconcileProjects disk-scan
 * model. Exported for unit tests.
 */
export function listLocalProjectIds(
  mapProjectIds: string[],
  projectsDir: string,
  fsApi: Pick<typeof fs, "readdirSync" | "statSync"> = fs,
): string[] {
  const ids = new Set(mapProjectIds);
  try {
    for (const name of fsApi.readdirSync(projectsDir)) {
      if (typeof name !== "string" || name.startsWith(".")) continue;
      try {
        if (fsApi.statSync(path.join(projectsDir, name)).isDirectory()) ids.add(name);
      } catch {
        // dir vanished between readdir and stat — treat as gone
      }
    }
  } catch {
    // projects dir absent — fresh install, map ids are all we have
  }
  return [...ids];
}

const API_URL = process.env.SYNAPSE_API_URL ?? "https://api.synapsesync.app";

interface SyncStep {
  step: number;
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
}

function readApiKey(): string | null {
  if (process.env.SYNAPSE_API_KEY) return process.env.SYNAPSE_API_KEY;
  const root = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  const cfgPath = path.join(root, "config.json");
  if (!fs.existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as { api_key?: string };
    return cfg.api_key ?? null;
  } catch {
    return null;
  }
}

function info(s: string): void {
  process.stdout.write(`${s}\n`);
}

function startStep(label: string): void {
  process.stdout.write(`▶ ${label}... `);
}

function finishStep(detail: string, ok: boolean): void {
  if (ok) {
    process.stdout.write(`done (${detail})\n`);
  } else {
    process.stdout.write(`✗ ${detail}\n`);
  }
}

export async function runSync(): Promise<number> {
  const apiKey = readApiKey();
  if (!apiKey) {
    process.stdout.write("✗ No API key found.\n");
    process.stdout.write("  Set SYNAPSE_API_KEY or run `synapsesync wizard` to install one.\n");
    return 1;
  }

  const overallStart = Date.now();
  const steps: SyncStep[] = [];

  // ── Step 1: read local event queue ─────────────────────────────────
  startStep("Reading local event queue");
  const t1 = Date.now();
  const map = readProjectMap();
  const projectIds = listLocalProjectIds(
    Object.values(map).map((m) => m.project_id),
    path.join(synapseRoot(), "projects"),
  );
  let totalEvents = 0;
  for (const pid of projectIds) {
    try {
      totalEvents += readEvents(projectDir(pid)).length;
    } catch {
      // Stale / missing project dir — skip; the flush step's reconcile will catch it
    }
  }
  finishStep(`${totalEvents} event(s) pending across ${projectIds.length} project(s)`, true);
  steps.push({
    step: 1,
    name: "read-queue",
    ok: true,
    detail: `${totalEvents} events`,
    elapsedMs: Date.now() - t1,
  });

  if (projectIds.length === 0) {
    info("\n✓ Nothing to sync (no local projects tracked yet).");
    return 0;
  }

  // ── Step 2: push events to backend ─────────────────────────────────
  startStep("Pushing events to backend");
  const t2 = Date.now();
  let pushed = 0;
  let pushErrors = 0;
  for (const pid of projectIds) {
    try {
      const r = await runFlushCycle({ project_id: pid, api_key: apiKey, api_url: API_URL });
      pushed += r.flushed;
    } catch (err) {
      pushErrors++;
      console.error(`  · push failed for project ${pid}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const pushOk = pushErrors === 0;
  finishStep(pushOk ? `${pushed}/${totalEvents}` : `${pushed} pushed, ${pushErrors} project(s) errored`, pushOk);
  steps.push({
    step: 2,
    name: "push",
    ok: pushOk,
    detail: `pushed=${pushed} errors=${pushErrors}`,
    elapsedMs: Date.now() - t2,
  });

  // ── Step 3: pull handoff state for each project ────────────────────
  startStep("Pulling handoff state");
  const t3 = Date.now();
  let pulled = 0;
  let pullErrors = 0;
  for (const pid of projectIds) {
    try {
      await runPullCycle({ project_id: pid, api_key: apiKey, api_url: API_URL });
      pulled++;
    } catch {
      pullErrors++;
      // Pull errors are non-fatal — handoff might just not exist yet for a fresh project
    }
  }
  finishStep(`${pulled}/${projectIds.length} project(s)`, pullErrors === 0);
  steps.push({
    step: 3,
    name: "pull-handoff",
    ok: pullErrors === 0,
    detail: `${pulled} projects`,
    elapsedMs: Date.now() - t3,
  });

  // ── Final summary ─────────────────────────────────────────────────
  const totalMs = Date.now() - overallStart;
  const failed = steps.filter((s) => !s.ok);
  if (failed.length === 0) {
    info(`\n✓ Synced in ${(totalMs / 1000).toFixed(1)}s`);
    return 0;
  }
  info(`\n✗ Sync completed with ${failed.length} error(s) in ${(totalMs / 1000).toFixed(1)}s`);
  for (const f of failed) {
    info(`  · step ${f.step} (${f.name}): ${f.detail}`);
  }
  return 1;
}
