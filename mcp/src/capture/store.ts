import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession } from "./types.js";

export class SessionStore {
  private dir: string;

  constructor(dir?: string) {
    // `os.homedir()` returns the user home on every platform — including
    // Windows (`C:\Users\<user>`), where `process.env.HOME` is undefined
    // by default (Windows uses `USERPROFILE`). The previous
    // `process.env.HOME ?? "~"` fallback created a literal `~` directory
    // in the current working directory on Windows.
    this.dir = dir ?? path.join(os.homedir(), ".synapse", "sessions");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  save(session: CapturedSession): void {
    fs.writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2));
  }

  load(id: string): CapturedSession | null {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as CapturedSession;
  }

  delete(id: string): void {
    const fp = this.filePath(id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  list(): CapturedSession[] {
    if (!fs.existsSync(this.dir)) return [];
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const sessions = files.map((f) => {
      return JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")) as CapturedSession;
    });
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
}
