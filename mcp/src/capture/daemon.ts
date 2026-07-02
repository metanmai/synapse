import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeBrief } from "./handoff-brief.js";
import { flushNowSignalPath, healthcheckPath } from "./handoff-paths.js";
import { runFlushCycle, runPullCycle } from "./handoff-sync.js";

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

export function startHandoffLoop(a: HandoffLoopArgs): () => void {
  const pull_ms = a.pull_ms ?? 15000;
  const flush_ms = a.flush_ms ?? 10000;
  const hc_ms = a.healthcheck_ms ?? 10000;
  let stopped = false;

  async function cycle() {
    if (stopped) return;
    for (const project_id of a.projects) {
      try {
        await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        await runPullCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        if (a.user_id) writeBrief(project_id, a.user_id);
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
