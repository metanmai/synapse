import fs from "node:fs";
import path from "node:path";
import { readEvents } from "./events-log.js";
import { projectDir, synapseRoot } from "./handoff-paths.js";

interface SyncErrorEntry {
  code: string;
  at: string;
  detail?: string;
}

const MAX_CACHED_ERRORS = 10;

/**
 * Persist a structured sync error to ~/.synapse/sync-errors.json so the
 * SessionStart brief can render a `## Sync error` section on the next
 * session. FIFO-pruned at MAX_CACHED_ERRORS to bound growth.
 *
 * Wrapped in try/catch — a filesystem error here MUST NOT kill the daemon
 * cycle. The error message is already logged before this is called; the
 * cache is a "nice to have" for brief surfacing.
 */
function cacheSyncError(entry: Omit<SyncErrorEntry, "at">): void {
  try {
    const file = path.join(synapseRoot(), "sync-errors.json");
    let data: { errors: SyncErrorEntry[] } = { errors: [] };
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as { errors?: SyncErrorEntry[] };
        data = { errors: raw.errors ?? [] };
      } catch {
        // Corrupted file — overwrite with fresh
      }
    }
    data.errors.push({ ...entry, at: new Date().toISOString() });
    if (data.errors.length > MAX_CACHED_ERRORS) {
      data.errors = data.errors.slice(-MAX_CACHED_ERRORS);
    }
    fs.mkdirSync(synapseRoot(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[sync] cacheSyncError failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
}

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

  // Phase 2 (D-08): events tagged with `_pulled: true` were pulled FROM the
  // backend by runEagerPullCycle on a fresh-install machine. Do NOT echo them
  // back to /events/batch — they're already durable server-side, and pinging
  // them back creates a feedback loop. The watermark still advances past them
  // (we've "seen" them, so the next flush starts after them) per RESEARCH
  // §Pitfall 4 — belt-and-suspenders against watermark-only filtering.
  const flushable = pending.filter((e) => !(e as { _pulled?: boolean })._pulled);
  if (flushable.length === 0) {
    fs.writeFileSync(wmPath, pending[pending.length - 1].event_id);
    return { flushed: 0 };
  }

  const res = await fetch(`${a.api_url}/api/events/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${a.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ events: flushable }),
  });
  if (!res.ok) {
    // Phase 03-02: surface PROJECT_QUOTA_EXCEEDED specially so the brief can
    // render a `## Sync error` section on the next SessionStart. Other failures
    // remain throws (transient — retried on next cycle).
    if (res.status === 402) {
      try {
        const body = (await res.clone().json()) as { code?: string; error?: string };
        if (body.code === "PROJECT_QUOTA_EXCEEDED") {
          console.error(
            `[sync] events/batch rejected: 50/50 project limit reached. Delete a project in the dashboard to continue capturing new repos.`,
          );
          cacheSyncError({ code: "PROJECT_QUOTA_EXCEEDED", detail: body.error });
          // Do NOT advance the watermark — events stay queued for retry after
          // the user frees a slot. Return zero-flushed so the daemon cycle
          // continues with other projects.
          return { flushed: 0 };
        }
      } catch {
        // Body wasn't JSON — fall through to throw
      }
    }
    throw new Error(`batch failed: ${res.status}`);
  }

  let canonicalId: string | undefined;
  try {
    const body = (await res.json()) as BatchResponse;
    const remapped = body.canonical_project_ids?.[a.project_id];
    if (remapped && remapped !== a.project_id) {
      const newDir = projectDir(remapped);
      const lastEventId = pending[pending.length - 1].event_id;
      if (fs.existsSync(newDir)) {
        // Destination already exists — typically because a prior cycle
        // already canonicalized this cwd, then the hook re-created the
        // `cwd_<hash>` dir before its project-map caught up. Merge: append
        // the pseudo-dir's events into the canonical events.jsonl, advance
        // the watermark past everything in pseudo (never regress it), then
        // remove the pseudo dir. The backend dedupes by event_id, so a
        // re-flushed event is safe — we'd rather over-deliver than lose.
        const pseudoEvents = path.join(dir, "events.jsonl");
        const canonicalEvents = path.join(newDir, "events.jsonl");
        if (fs.existsSync(pseudoEvents)) {
          const pseudoBody = fs.readFileSync(pseudoEvents, "utf-8");
          if (pseudoBody.length > 0) fs.appendFileSync(canonicalEvents, pseudoBody);
        }
        const wmDest = path.join(newDir, ".watermark");
        const existingWm = fs.existsSync(wmDest) ? fs.readFileSync(wmDest, "utf-8").trim() : "";
        fs.writeFileSync(wmDest, lastEventId > existingWm ? lastEventId : existingWm);
        fs.rmSync(dir, { recursive: true, force: true });
      } else {
        fs.renameSync(dir, newDir);
        fs.writeFileSync(path.join(newDir, ".watermark"), lastEventId);
      }
      canonicalId = remapped;
    }
  } catch {
    // Body wasn't JSON or the canonical-remap step failed in a way that
    // doesn't impact the at-least-once delivery contract (events already
    // POSTed above). Considered successful — the next cycle will retry the
    // remap if the backend keeps sending canonical_project_ids.
  }

  if (!canonicalId) {
    fs.writeFileSync(wmPath, pending[pending.length - 1].event_id);
  }
  return { flushed: flushable.length, canonical_project_id: canonicalId };
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

interface EventsResponse {
  events?: unknown[];
  next_since?: string | null;
}

/**
 * Phase 2 (IDENT-02, D-08): one-shot historical event pull, called by the
 * daemon cycle the first time a `cwd_<hash>` is remapped to a canonical
 * project_id. Pulls the project's recent events from the backend and writes
 * them into events.jsonl with a `_pulled: true` marker so runFlushCycle
 * doesn't echo them back. Idempotence relies on (a) the call site only firing
 * inside the `if (canonical_project_id)` branch of the daemon cycle, and
 * (b) the `_pulled` filter in runFlushCycle preventing feedback loops if a
 * crash leaves the watermark unset.
 */
export async function runEagerPullCycle(a: FlushArgs & { limit?: number }): Promise<{ pulled: number }> {
  const limit = a.limit ?? 500;
  const res = await fetch(`${a.api_url}/api/projects/${a.project_id}/events?limit=${limit}`, {
    headers: { Authorization: `Bearer ${a.api_key}` },
  });
  if (!res.ok) throw new Error(`eager pull failed: ${res.status}`);
  const body = (await res.json()) as EventsResponse;
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) return { pulled: 0 };

  const dir = projectDir(a.project_id);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "events.jsonl");
  const wmPath = path.join(dir, ".watermark");

  // Tag each pulled event with _pulled: true so runFlushCycle skips them on
  // subsequent flushes. Write all in one shot; if the process dies mid-write
  // a re-pull on next cycle is safe (events are server-side durable).
  const lines = events.map((e) => JSON.stringify({ ...(e as object), _pulled: true })).join("\n");
  fs.appendFileSync(logPath, `${lines}\n`);

  // Advance the watermark to the highest pulled event_id. Backend returns
  // events ascending by event_id (ULIDs are lex-sortable), so the last entry
  // is the highest. If the response shape deviates, fall back to scanning.
  const last = events[events.length - 1] as { event_id?: string } | undefined;
  if (last?.event_id) {
    fs.writeFileSync(wmPath, last.event_id);
  }
  return { pulled: events.length };
}
