import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { type Supervisor, checkSupervisor } from "../cli/util/daemon-supervisor.js";
import { BASE_DELAY_MS, computeNextDelay } from "./daemon-backoff.js";
import { spawnInferNextStep } from "./daemon-cc.js";
import { appendEvent, readEvents } from "./events-log.js";
import { writeBrief } from "./handoff-brief.js";
import { flushNowSignalPath, healthcheckPath, projectDir, synapseRoot } from "./handoff-paths.js";
import { runEagerPullCycle, runFlushCycle, runPullCycle } from "./handoff-sync.js";
import { synthesizeHeuristicNextStep } from "./heuristic-synth.js";

/**
 * Minimum interval between daemon-triggered pull-handoff pre-warms for the
 * same project. The `pull-handoff` recompute spawns `claude -p` and costs
 * ~$0.02 per call. With a busy session firing batch flushes every ~10s,
 * unthrottled spawns would burn dollars per hour and saturate the LLM
 * rate-limit. At 5 minutes per project, the worst-case cost is ~$0.24/hr per
 * actively-edited project — acceptable for the killer-feature payoff (next
 * session has fresh context even after ctrl+C / crash / power loss).
 *
 * Exported as a constant rather than hard-coded so the unit test can assert
 * against the same value the production loop uses.
 */
export const PREWARM_MIN_INTERVAL_MS = 5 * 60 * 1000;

interface DaemonStatus {
  running: boolean;
  pid: number | null;
  supervisor: Supervisor;
}

export class DaemonManager {
  private dir: string;
  private pidFile: string;
  private logFile: string;

  constructor(dir?: string) {
    this.dir = dir ?? process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
    fs.mkdirSync(this.dir, { recursive: true });
    this.pidFile = path.join(this.dir, "capture.pid");
    this.logFile = path.join(this.dir, "capture.log");
  }

  writePid(pid: number): void {
    fs.writeFileSync(this.pidFile, String(pid));
  }

  readPid(): number | null {
    if (!fs.existsSync(this.pidFile)) return null;
    const raw = fs.readFileSync(this.pidFile, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  }

  isRunning(): boolean {
    return this.status().running;
  }

  cleanup(): void {
    if (fs.existsSync(this.pidFile)) fs.unlinkSync(this.pidFile);
  }

  status(): DaemonStatus {
    const sup = checkSupervisor();
    if (sup.running) return sup;
    // Tier-2 fallback: PID file + signal-0 check.
    const pid = this.readPid();
    if (pid === null) return { running: false, pid: null, supervisor: null };
    try {
      process.kill(pid, 0);
      return { running: true, pid, supervisor: null };
    } catch {
      this.cleanup();
      return { running: false, pid: null, supervisor: null };
    }
  }

  getLogFile(): string {
    return this.logFile;
  }
}

export interface HandoffLoopArgs {
  projects: string[];
  api_key: string;
  api_url: string;
  user_id?: string;
  pull_ms?: number;
  flush_ms?: number;
  healthcheck_ms?: number;
  /**
   * Absolute path to `~/.synapse/projects/`. When set, the loop re-scans this
   * directory on every cycle to pick up project dirs created AFTER the daemon
   * started — e.g., the typical install flow (daemon starts → user opens AI
   * tool → hook creates project dir). Without this, projects created
   * post-startup are invisible until daemon restart.
   *
   * Optional for test backwards-compat: tests that pass an explicit
   * `projects` array can omit this to keep the snapshot-only semantics.
   */
  projects_dir?: string;
  /**
   * Phase 03-05: tier override. When set, the daemon SKIPS the
   * /api/billing/status fetch and uses this value directly. Used by:
   *  - tests, which don't have a billing endpoint to call
   *  - hypothetical "force Plus for debugging" flows
   * Production omits this; the daemon fetches + caches the tier itself.
   * `"free"` → cycle returns immediately (no flush/pull/prewarm).
   * `"plus"` → cycle runs the full loop.
   */
  tier_override?: "free" | "plus";
  /**
   * Optional override for the pull-handoff pre-warm spawn. Production
   * omits this and the loop spawns a detached child via `spawnPrewarm`.
   * Tests inject a no-op so vitest workers don't leak detached children
   * (which on Windows can cause the worker to be reported as "exited
   * unexpectedly" during teardown even when all tests pass).
   */
  _spawnPrewarmFn?: (projectId: string, apiKey: string, apiUrl: string) => void;
}

interface FireArgs {
  project_id: string;
  idle_threshold_ms: number;
  spawnFn?: typeof spawnInferNextStep;
}

export async function maybeFireInferNextStep(a: FireArgs): Promise<void> {
  const events = readEvents(projectDir(a.project_id));
  if (events.length === 0) return;

  const lastEvent = events.at(-1);
  if (!lastEvent) return;
  const lastEventTime = new Date(lastEvent.occurred_at).getTime();
  if (Date.now() - lastEventTime < a.idle_threshold_ms) return;

  const sinceIdle = events.filter((e) => new Date(e.occurred_at).getTime() >= lastEventTime - a.idle_threshold_ms);
  if (sinceIdle.some((e) => e.kind === EventKind.NextStepSet)) return;

  const summary = events
    .slice(-30)
    .map((e) => `${e.kind}: ${JSON.stringify(e.payload).slice(0, 80)}`)
    .join("\n");
  const fn = a.spawnFn ?? spawnInferNextStep;

  let text: string;
  let inferred_method: "llm" | "heuristic";
  try {
    text = await fn({ project_id: a.project_id, recent_events_summary: summary });
    inferred_method = "llm";
  } catch (err) {
    console.warn("[handoff] LLM inference failed, falling back to heuristic:", err);
    text = synthesizeHeuristicNextStep(events);
    inferred_method = "heuristic";
  }

  if (!text || text.length === 0) return;

  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: "daemon",
    attached_to: null,
    actor: {
      user_id: lastEvent.actor.user_id,
      kind: "synapse-daemon",
      device_id: "daemon",
      hostname: "daemon",
      client: "claude-code",
    },
    kind: EventKind.NextStepInferred,
    occurred_at: new Date().toISOString(),
    payload: { text, on_behalf_of: lastEvent.actor.user_id, inferred_method },
  });
}

/**
 * Pure debounce decision for daemon-triggered pull-handoff pre-warms.
 *
 * Returns true iff `projectId` has either never been pre-warmed (no entry
 * in `lastPrewarmAt`) or was last pre-warmed `>= intervalMs` ago. Exported
 * so the unit test can drive it without spinning the full handoff loop —
 * the previous design (debounce inline in the cycle closure) was effectively
 * untestable because asserting state required hooking child_process.spawn.
 */
export function shouldPrewarm(
  lastPrewarmAt: Map<string, number>,
  projectId: string,
  now: number,
  intervalMs: number,
): boolean {
  const last = lastPrewarmAt.get(projectId);
  if (last === undefined) return true;
  return now - last >= intervalMs;
}

/**
 * Spawn `synapsesync pull-handoff --project-id <id>` as a detached child so
 * the recompute (claude -p, 30-60s) survives the daemon's lifetime and
 * completes even if the daemon is restarted or the user kills the parent
 * process. Fire-and-forget; stderr lands in `~/.synapse/daemon-prewarm.log`
 * for diagnosis.
 *
 * Env-passes the daemon's `SYNAPSE_API_KEY` + `SYNAPSE_API_URL` so the child
 * doesn't need to re-read config.json. That's belt-and-suspenders — the
 * config path also works — but explicit env is cheaper and survives config
 * file races.
 *
 * Exported for tests; the spawn target is overridable via the `spawnFn`
 * arg so unit tests can assert without actually launching node subprocesses.
 */
export function spawnPrewarm(
  projectId: string,
  apiKey: string,
  apiUrl: string,
  spawnFn: typeof child_process.spawn = child_process.spawn,
): void {
  try {
    const logFile = path.join(synapseRoot(), "daemon-prewarm.log");
    fs.mkdirSync(synapseRoot(), { recursive: true });
    const out = fs.openSync(logFile, "a");
    // dist/capture/daemon.js → dist/index.js (../index.js relative to this
    // compiled file). Same pattern as pre-compact.ts spawn.
    const cliEntry = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "index.js");
    const child = spawnFn(process.execPath, [cliEntry, "pull-handoff", "--project-id", projectId], {
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        SYNAPSE_API_KEY: apiKey,
        SYNAPSE_API_URL: apiUrl,
        SYNAPSE_DAEMON_PREWARM: "1",
      },
    });
    // Defensive: a spawn failure (missing dist/, bad PATH, AV blocking on
    // Windows) emits an async 'error' event. Without a listener, Node's
    // default behavior is to throw "Unhandled 'error' event" — which kills
    // the daemon process AND, in test runs, kills the vitest worker mid-
    // suite (causing "Worker exited unexpectedly"). Log and swallow; the
    // next cycle's debounce check will retry if appropriate.
    child.on("error", (err) => {
      try {
        fs.appendFileSync(
          path.join(synapseRoot(), "daemon-prewarm.log"),
          `[${new Date().toISOString()}] spawn ERROR project=${projectId} err=${err instanceof Error ? err.message : err}\n`,
        );
      } catch {}
    });
    child.unref();
  } catch (err) {
    try {
      fs.appendFileSync(
        path.join(synapseRoot(), "daemon-prewarm.log"),
        `[${new Date().toISOString()}] spawn FAILED project=${projectId} err=${err instanceof Error ? err.message : err}\n`,
      );
    } catch {
      // truly nothing we can do; the next cycle will retry the debounce check
    }
  }
}

/**
 * Phase 03-05: tier cache for the daemon's cycle gate.
 *
 * Free users have manual sync only — `synapsesync sync` triggers a one-shot
 * flush+pull, but the daemon's 5-min auto-loop is gated off. Plus users get
 * the full auto-sync cycle. We cache the tier for 5 minutes so we're not
 * hitting /api/billing/status every cycle (which would itself become a
 * cycle of its own).
 *
 * Upgrade latency on tier flip: up to 5 min for the daemon to pick up the
 * Plus tier. A follow-up commit will add tier_revision header piggyback
 * on existing endpoints to invalidate this cache near-instantly.
 */
const TIER_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedTier {
  tier: "free" | "plus";
  fetchedAt: number;
}

async function getTierCached(
  apiKey: string,
  apiUrl: string,
  state: { cached: CachedTier | null },
): Promise<"free" | "plus"> {
  const now = Date.now();
  if (state.cached && now - state.cached.fetchedAt < TIER_CACHE_TTL_MS) {
    return state.cached.tier;
  }
  try {
    const r = await fetch(`${apiUrl}/api/billing/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      // Network blip or backend issue — return cached value if we have one,
      // else assume "free" (the more restrictive default, so a free user
      // isn't accidentally auto-syncing during a backend outage).
      return state.cached?.tier ?? "free";
    }
    const body = (await r.json()) as { tier?: string };
    const tier = body.tier === "plus" ? "plus" : "free";
    state.cached = { tier, fetchedAt: now };
    return tier;
  } catch {
    return state.cached?.tier ?? "free";
  }
}

export function startHandoffLoop(a: HandoffLoopArgs): () => void {
  const hc_ms = a.healthcheck_ms ?? 10000;
  let stopped = false;
  let currentDelay = BASE_DELAY_MS;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-project debounce state for daemon-triggered pull-handoff pre-warms.
  // Keyed by canonical project_id (post-remap). Lives in the closure so each
  // daemon process gets a fresh map on startup — that's intentional: after a
  // restart we want a fresh pre-warm to confirm the cache is current, even
  // though the previous process may have pre-warmed seconds ago.
  const lastPrewarmAt = new Map<string, number>();
  // Phase 03-05: tier cache for cycle-gating. Free skips the auto-loop;
  // Plus runs the full cycle.
  const tierState: { cached: CachedTier | null } = { cached: null };

  async function cycle(): Promise<boolean> {
    if (stopped) return true;

    // Phase 03-05: tier-gate. Free users get MANUAL sync via `synapsesync
    // sync` only — the auto-loop is gated off here. Hook-driven syncs
    // (SessionEnd, PreCompact) STILL push inline (they don't go through
    // this loop), so single-device brief continuity works for Free.
    //
    // Tests pass `tier_override` to skip the billing fetch (no endpoint
    // available in test env); production omits it and we fetch + cache.
    const tier = a.tier_override ?? (await getTierCached(a.api_key, a.api_url, tierState));
    if (tier === "free") {
      return true;
    }

    // Re-scan the projects dir each cycle so dirs created after daemon
    // startup become visible without requiring a restart.
    //
    // (1) Drop stale entries whose dir has been deleted (e.g. after a
    //     canonical-id remap deleted the cwd_<hash> pseudo-dir). Without
    //     this prune step, every subsequent cycle threw
    //       ENOENT: ... cwd_<hash>/.watermark
    //     and the daemon log filled up with per-cycle error spam. The
    //     canonical-rename bookkeeping (a.projects[i] = canonicalId) is
    //     preserved because the canonical dir IS still present on disk
    //     and the additive scan below re-adds it as a fresh entry — so
    //     this prune doesn't lose any work.
    // (2) Additive scan: pick up any new dirs created since last cycle.
    if (a.projects_dir && fs.existsSync(a.projects_dir)) {
      reconcileProjects(a.projects, a.projects_dir);
    }
    let ok = true;
    for (let i = 0; i < a.projects.length; i++) {
      const project_id = a.projects[i];
      try {
        const flush = await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        const effectiveId = flush.canonical_project_id ?? project_id;
        if (flush.canonical_project_id) {
          a.projects[i] = flush.canonical_project_id;
          // Phase 2 (D-08): first-time remap — eager-pull the project's
          // recent events from the backend so machine-B sees machine-A's
          // history immediately, not after a fresh round of activity.
          await runEagerPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
        }
        await runPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
        if (a.user_id) writeBrief(effectiveId, a.user_id);
        // Continuous handoff pre-warm — the killer-feature fix. Without
        // this, the SessionStart brief is only refreshed by graceful hooks
        // (PreCompact, SessionEnd). Real-world session terminations
        // (ctrl+C, terminal close, OOM, network drop) bypass those hooks
        // entirely, so the next session sees a stale handoff (sometimes
        // days old). By spawning a detached pull-handoff whenever we
        // flush new events — debounced 5min per project to cap LLM cost —
        // the backend's handoff cache stays within minutes of live state.
        // A ctrl+C now means "lose at most the last 5 minutes," not
        // "lose everything since the last graceful shutdown."
        if (flush.flushed > 0 && shouldPrewarm(lastPrewarmAt, effectiveId, Date.now(), PREWARM_MIN_INTERVAL_MS)) {
          lastPrewarmAt.set(effectiveId, Date.now());
          (a._spawnPrewarmFn ?? spawnPrewarm)(effectiveId, a.api_key, a.api_url);
        }
      } catch (err) {
        console.error("[handoff] cycle error", project_id, err);
        ok = false;
      }
    }
    return ok;
  }

  async function scheduleNext(): Promise<void> {
    if (stopped) return;
    const ok = await cycle();
    if (stopped) return;
    currentDelay = computeNextDelay(currentDelay, ok);
    nextTimer = setTimeout(scheduleNext, currentDelay);
  }

  // Flush-now signal poll — UNCHANGED. User-initiated; does NOT participate
  // in backoff (per RESEARCH §"Pattern 5").
  const signalCheck = setInterval(async () => {
    if (fs.existsSync(flushNowSignalPath())) {
      try {
        fs.unlinkSync(flushNowSignalPath());
      } catch {}
      await cycle();
    }
  }, 100);

  // Healthcheck timer — UNCHANGED.
  const hcTimer = setInterval(() => {
    fs.mkdirSync(path.dirname(healthcheckPath()), { recursive: true });
    fs.writeFileSync(healthcheckPath(), new Date().toISOString());
  }, hc_ms);

  // Self-rescheduling backoff chain replaces the previous `setInterval(cycle, ...)`.
  scheduleNext();

  return () => {
    stopped = true;
    clearInterval(signalCheck);
    if (nextTimer) clearTimeout(nextTimer);
    clearInterval(hcTimer);
  };
}

/**
 * Reconcile the in-memory `projects` array against the on-disk projects
 * dir. Mutates `projects` in place — pure function aside from that
 * (the dir read is what makes it not 100% pure; tests pass a tmpdir).
 *
 * Two operations, in this order:
 *   1. Prune: drop entries whose dir no longer exists. This is what
 *      happens after a canonical-id remap deletes the cwd_<hash>
 *      pseudo-dir — without the prune step, every subsequent cycle
 *      threw `ENOENT: ... cwd_<hash>/.watermark` and the daemon log
 *      filled with per-cycle error spam.
 *   2. Additive: pick up any on-disk dirs that aren't tracked yet.
 *      Used so projects created after daemon startup (e.g. a fresh
 *      `cd` into a new repo + first SessionStart hook) become visible
 *      without restarting the daemon.
 *
 * Exported so it can be unit-tested without spinning up the full
 * handoff loop.
 */
export function reconcileProjects(projects: string[], projectsDir: string): void {
  const onDisk = new Set<string>();
  for (const name of fs.readdirSync(projectsDir)) {
    if (name.startsWith(".")) continue;
    try {
      if (fs.statSync(path.join(projectsDir, name)).isDirectory()) {
        onDisk.add(name);
      }
    } catch {
      // Race with another process deleting the dir between readdir
      // and stat — treat as gone.
    }
  }

  // Prune: keep only entries whose dir still exists.
  for (let i = projects.length - 1; i >= 0; i--) {
    if (!onDisk.has(projects[i])) {
      projects.splice(i, 1);
    }
  }

  // Additive: add any on-disk dirs that aren't tracked yet.
  const known = new Set(projects);
  for (const name of onDisk) {
    if (!known.has(name)) projects.push(name);
  }
}
