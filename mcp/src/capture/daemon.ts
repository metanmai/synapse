import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { type Supervisor, checkSupervisor } from "../cli/util/daemon-supervisor.js";
import { BASE_DELAY_MS, computeNextDelay } from "./daemon-backoff.js";
import { spawnInferNextStep } from "./daemon-cc.js";
import { appendEvent, readEvents } from "./events-log.js";
import { writeBrief } from "./handoff-brief.js";
import { flushNowSignalPath, healthcheckPath, projectDir } from "./handoff-paths.js";
import { runEagerPullCycle, runFlushCycle, runPullCycle } from "./handoff-sync.js";
import { synthesizeHeuristicNextStep } from "./heuristic-synth.js";

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
    this.dir = dir ?? path.join(os.homedir(), ".synapse");
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

export function startHandoffLoop(a: HandoffLoopArgs): () => void {
  const hc_ms = a.healthcheck_ms ?? 10000;
  let stopped = false;
  let currentDelay = BASE_DELAY_MS;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;

  async function cycle(): Promise<boolean> {
    if (stopped) return true;
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
