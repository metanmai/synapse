import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
