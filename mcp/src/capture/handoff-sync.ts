import fs from "node:fs";
import path from "node:path";
import { readEvents } from "./events-log.js";
import { projectDir } from "./handoff-paths.js";

export interface FlushArgs {
  project_id: string;
  api_key: string;
  api_url: string;
}

export async function runFlushCycle(a: FlushArgs): Promise<{ flushed: number }> {
  const dir = projectDir(a.project_id);
  const wmPath = path.join(dir, ".watermark");
  const wm = fs.existsSync(wmPath) ? fs.readFileSync(wmPath, "utf-8").trim() : null;
  const all = readEvents(dir);
  const pending = wm ? all.filter((e) => e.event_id > wm) : all;
  if (pending.length === 0) return { flushed: 0 };

  const res = await fetch(`${a.api_url}/api/events/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${a.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ events: pending }),
  });
  if (!res.ok) throw new Error(`batch failed: ${res.status}`);

  fs.writeFileSync(wmPath, pending[pending.length - 1].event_id);
  return { flushed: pending.length };
}

export async function runPullCycle(a: FlushArgs): Promise<{ pulled: number }> {
  const dir = projectDir(a.project_id);
  const statusPath = path.join(dir, "cache/project_status.json");
  const res = await fetch(`${a.api_url}/api/projects/${a.project_id}/status`, {
    headers: { Authorization: `Bearer ${a.api_key}` },
  });
  if (res.status === 404) return { pulled: 0 };
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  const status = await res.json();
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  return { pulled: 1 };
}
