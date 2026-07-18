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

  private filePath(tool: CapturedSession["tool"], id: string): string {
    return path.join(this.dir, "v2", encodePathSegment(tool), `${encodePathSegment(id)}.json`);
  }

  private legacyFilePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  save(session: CapturedSession): void {
    const fp = this.filePath(session.tool, session.id);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(session, null, 2));

    // Pre-v2 stores used only `<session_id>.json`. Remove that legacy copy
    // after the composite-key write succeeds, but only when its embedded tool
    // matches. A same-ID record from another tool must never be deleted.
    const legacy = this.legacyFilePath(session.id);
    if (readSession(legacy)?.tool === session.tool) fs.unlinkSync(legacy);
  }

  load(tool: CapturedSession["tool"], id: string): CapturedSession | null {
    const current = readSession(this.filePath(tool, id));
    if (current) return current;

    // Backward-compatible read for sessions captured before composite keys.
    // The payload's tool is the only trustworthy source discriminator in the
    // legacy filename format.
    const legacy = readSession(this.legacyFilePath(id));
    return legacy?.tool === tool ? legacy : null;
  }

  delete(tool: CapturedSession["tool"], id: string): void {
    const fp = this.filePath(tool, id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);

    const legacy = this.legacyFilePath(id);
    if (readSession(legacy)?.tool === tool) fs.unlinkSync(legacy);
  }

  list(): CapturedSession[] {
    if (!fs.existsSync(this.dir)) return [];
    const sessions = new Map<string, CapturedSession>();
    for (const fp of this.sessionFiles()) {
      const session = readSession(fp);
      if (!session) continue;
      const key = `${session.tool}\0${session.id}`;
      const existing = sessions.get(key);
      if (!existing || new Date(session.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
        sessions.set(key, session);
      }
    }
    return [...sessions.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  private sessionFiles(): string[] {
    const files = fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.dir, entry.name));

    const v2Dir = path.join(this.dir, "v2");
    if (!fs.existsSync(v2Dir)) return files;
    for (const toolDir of fs.readdirSync(v2Dir, { withFileTypes: true })) {
      if (!toolDir.isDirectory()) continue;
      const sourceDir = path.join(v2Dir, toolDir.name);
      for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) files.push(path.join(sourceDir, entry.name));
      }
    }
    return files;
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

function readSession(filePath: string): CapturedSession | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CapturedSession;
}
