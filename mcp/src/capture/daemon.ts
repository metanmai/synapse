import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { spawnInferNextStep } from "./daemon-cc.js";
import { appendEvent, readEvents } from "./events-log.js";
import { writeBrief } from "./handoff-brief.js";
import { flushNowSignalPath, healthcheckPath, projectDir } from "./handoff-paths.js";
import { runFlushCycle, runPullCycle } from "./handoff-sync.js";
import { synthesizeHeuristicNextStep } from "./heuristic-synth.js";

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
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
    const pid = this.readPid();
    if (pid === null) return false;
    try {
      process.kill(pid, 0); // Signal 0 = check if process exists
      return true;
    } catch {
      this.cleanup();
      return false;
    }
  }

  cleanup(): void {
    if (fs.existsSync(this.pidFile)) fs.unlinkSync(this.pidFile);
  }

  status(): DaemonStatus {
    const pid = this.readPid();
    const running = this.isRunning();
    return { running, pid: running ? pid : null };
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

export interface FireArgs {
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
  const pull_ms = a.pull_ms ?? 15000;
  const flush_ms = a.flush_ms ?? 10000;
  const hc_ms = a.healthcheck_ms ?? 10000;
  let stopped = false;

  async function cycle() {
    if (stopped) return;
    for (let i = 0; i < a.projects.length; i++) {
      const project_id = a.projects[i];
      try {
        const flush = await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        const effectiveId = flush.canonical_project_id ?? project_id;
        if (flush.canonical_project_id) {
          a.projects[i] = flush.canonical_project_id;
        }
        await runPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
        if (a.user_id) writeBrief(effectiveId, a.user_id);
      } catch (err) {
        console.error("[handoff] cycle error", project_id, err);
      }
    }
  }

  const signalCheck = setInterval(async () => {
    if (fs.existsSync(flushNowSignalPath())) {
      try {
        fs.unlinkSync(flushNowSignalPath());
      } catch {}
      await cycle();
    }
  }, 100);

  const cycleTimer = setInterval(cycle, Math.min(pull_ms, flush_ms));

  const hcTimer = setInterval(() => {
    fs.mkdirSync(path.dirname(healthcheckPath()), { recursive: true });
    fs.writeFileSync(healthcheckPath(), new Date().toISOString());
  }, hc_ms);

  cycle();

  return () => {
    stopped = true;
    clearInterval(signalCheck);
    clearInterval(cycleTimer);
    clearInterval(hcTimer);
  };
}
