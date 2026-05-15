import fs from "node:fs";
import path from "node:path";
import { readEvents } from "./events-log.js";
import { projectDir } from "./handoff-paths.js";

export interface FlushArgs {
  project_id: string;
  api_key: string;
  api_url: string;
}

export interface FlushResult {
  flushed: number;
  /**
   * Set when the backend auto-created (or matched) a canonical project for a
   * `cwd_<hash>` placeholder we just sent. Callers should swap their in-memory
   * project_id to this and refresh any project-map entries.
   */
  canonical_project_id?: string;
}

interface BatchResponse {
  accepted?: number;
  duplicates?: number;
  adjusted?: string[];
  canonical_project_ids?: Record<string, string>;
}

export async function runFlushCycle(a: FlushArgs): Promise<FlushResult> {
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

  let canonicalId: string | undefined;
  try {
    const body = (await res.json()) as BatchResponse;
    const remapped = body.canonical_project_ids?.[a.project_id];
    if (remapped && remapped !== a.project_id) {
      const newDir = projectDir(remapped);
      if (fs.existsSync(newDir)) {
        throw new Error(`auto-create remap collision: ${dir} -> ${newDir} (destination already exists)`);
      }
      fs.renameSync(dir, newDir);
      // Watermark now lives in the new dir, so write it there.
      fs.writeFileSync(path.join(newDir, ".watermark"), pending[pending.length - 1].event_id);
      canonicalId = remapped;
    }
  } catch (err) {
    // If the body wasn't JSON we still consider the flush successful — only
    // re-throw collision errors so the caller can surface them.
    if (err instanceof Error && err.message.startsWith("auto-create remap collision")) {
      throw err;
    }
  }

  if (!canonicalId) {
    fs.writeFileSync(wmPath, pending[pending.length - 1].event_id);
  }
  return { flushed: pending.length, canonical_project_id: canonicalId };
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
