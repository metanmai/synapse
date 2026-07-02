import fs from "node:fs";
import path from "node:path";
import { API_URL } from "../cli/config.js";
import { readProjectMap, removeProjectMapping, upsertProjectMapping } from "../cli/project-map.js";
import { type BackendResolveFn, type BackendResolveResponse, resolveProject } from "../cli/resolve-project.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import { resolveApiKey } from "./cloud-sync.js";
import { defaultRegistry } from "./default-registry.js";
import type { ToolAdapter } from "./types.js";

interface ConversationListItem {
  id: string;
  metadata?: Record<string, unknown> | null;
  updated_at: string;
}

interface FullConversation {
  id: string;
  metadata?: Record<string, unknown> | null;
  updated_at: string;
  working_context?: Record<string, unknown> | null;
}

export interface PullHandoffOptions {
  cwd: string;
  apiKey?: string;
  apiUrl?: string;
  registry?: AdapterRegistry;
  log?: (msg: string) => void;
}

/**
 * Pull the latest "where I left off" handoff for whichever conversation in
 * this project was touched most recently.
 *
 * Called by the SessionStart hook so a freshly-spawned agent inherits the
 * previous one's context. Recomputes via the tool's local CLI if the
 * stored handoff is stale (or missing); otherwise serves the cached copy
 * from `conversations.metadata.handoff_markdown`.
 *
 * Returns null when any required input is missing (no project mapping
 * yet, no API key, no conversations on the backend, network errors). The
 * caller treats null as "render the rest of the brief unchanged."
 */
export async function pullHandoff(opts: PullHandoffOptions): Promise<string | null> {
  const log = opts.log ?? (() => {});
  const apiUrl = opts.apiUrl ?? API_URL;
  const apiKey = opts.apiKey ?? resolveApiKey();
  if (!apiKey) {
    log("pull-compact: no API key, skipping");
    return null;
  }

  // Canonicalize cwd so symlinked entry paths route to the same project as
  // the canonical target. cloud-sync stores project-map keys post-realpath;
  // a mismatch here would silently miss for symlink users. Falls back to
  // the raw cwd if the path no longer exists.
  let canonicalCwd = opts.cwd;
  try {
    canonicalCwd = fs.realpathSync(opts.cwd);
  } catch {
    /* path gone — use raw */
  }

  const auth = { Authorization: `Bearer ${apiKey}` };

  // Resolve cwd → project. Local map first (fast, offline); on miss we
  // ask the backend's resolver. This is the cross-device cold-start path:
  // on a freshly installed machine the project-map is empty, and without
  // backend resolution every "first session" on a new device would silently
  // lose the handoff. The resolver only matches existing projects the user
  // can already see — it never creates one — so a true no-match still
  // returns null (caller treats null as "render the brief without handoff").
  const map = readProjectMap();
  const localMapping = map[canonicalCwd] ?? map[opts.cwd];
  let projectUuid: string;
  if (localMapping) {
    projectUuid = localMapping.project_id;
  } else {
    const resolveBackend: BackendResolveFn = async (signals) => {
      const res = await fetch(`${apiUrl}/api/projects/resolve`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(signals),
      });
      if (!res.ok) throw new Error(`resolve ${res.status}`);
      return (await res.json()) as BackendResolveResponse;
    };
    const resolved = await resolveProject(canonicalCwd, resolveBackend);
    if (!resolved.project_id || !resolved.name) {
      log(`pull-compact: could not resolve project for cwd=${canonicalCwd} (source=${resolved.source})`);
      return null;
    }
    projectUuid = resolved.project_id;
    // Write-through so the next session on this device is local-fast and
    // doesn't repeat the backend round-trip.
    try {
      upsertProjectMapping(canonicalCwd, { project_id: projectUuid, project_name: resolved.name });
      log(`pull-compact: cached resolved project ${projectUuid} for cwd=${canonicalCwd}`);
    } catch {
      /* best-effort cache; never fail the pull for it */
    }
  }

  // 1. Recent conversations (listConversations orders by updated_at desc).
  //    We fetch a small batch rather than just the newest because the daemon
  //    creates a conversation row at session START (before any PreCompact
  //    has posted a handoff). For short-lived sessions / claude -p subprocesses
  //    / tools without compaction, those rows linger as the "newest" forever
  //    with empty handoff_markdown. Without batching, the SessionStart hook
  //    would surface a bare brief even though older conversations in the
  //    same project hold valid handoff text.
  const LIST_BATCH = 5;
  let listed: ConversationListItem[];
  try {
    const res = await fetch(
      `${apiUrl}/api/conversations?project_id=${encodeURIComponent(projectUuid)}&limit=${LIST_BATCH}`,
      { headers: auth },
    );
    if (!res.ok) {
      log(`pull-compact: list returned ${res.status}`);
      // 404 here means the cached project_id is dead (deleted server-side
      // via synapse reset / dashboard / account wipe). Drop the stale
      // project-map entry so the NEXT capture-sync from this cwd auto-
      // creates a fresh project. The current SessionStart still emits a
      // brief without handoff (caller treats null as "no handoff").
      if (res.status === 404) {
        removeProjectMapping(canonicalCwd, projectUuid);
        log(`pull-compact: invalidated stale project-map entry for cwd=${canonicalCwd} (project ${projectUuid})`);
      }
      return null;
    }
    const body = (await res.json()) as { conversations?: ConversationListItem[] };
    listed = body.conversations ?? [];
  } catch (err) {
    log(`pull-compact: list exception: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (listed.length === 0) {
    log("pull-compact: no conversations in project");
    return null;
  }

  // 2. Find the most-recent conversation with a FRESH cached handoff —
  //    cached handoff postdating the last message means no work has been
  //    added since the brief was written. This walks past empty-newest
  //    rows (session-started-but-not-yet-compacted) to reach the real
  //    "where I left off" content. Track the newest non-fresh cachedHandoff
  //    as a fallback for when the recompute path below also fails.
  let staleFallback: string | null = null;
  for (const c of listed) {
    const m = (c.metadata ?? {}) as Record<string, unknown>;
    const cached = typeof m.handoff_markdown === "string" ? m.handoff_markdown : null;
    const at = typeof m.handoff_at === "string" ? m.handoff_at : null;
    if (cached && at && at >= c.updated_at) {
      log(`pull-compact: cache hit for ${c.id}`);
      return cached;
    }
    if (cached && !staleFallback) staleFallback = cached;
  }

  // 3. No fresh cache anywhere — recompute against the newest conversation
  //    (where the active session would be writing). This is unchanged from
  //    the original single-row path; only the cached-hit fan-out above is new.
  const conv = listed[0];
  const meta = (conv.metadata ?? {}) as Record<string, unknown>;
  const cachedHandoff = (typeof meta.handoff_markdown === "string" ? meta.handoff_markdown : null) ?? staleFallback;

  // 3. Stale or missing — recompute. We need working_context.capturedSessionId
  //    to find the local transcript; the list endpoint doesn't return it,
  //    so fetch the full row.
  let full: FullConversation | null = null;
  try {
    const res = await fetch(`${apiUrl}/api/conversations/${conv.id}`, { headers: auth });
    if (!res.ok) {
      log(`pull-compact: full GET returned ${res.status}`);
      return cachedHandoff;
    }
    const body = (await res.json()) as { conversation?: FullConversation } | FullConversation;
    full =
      "conversation" in (body as object)
        ? (body as { conversation: FullConversation }).conversation
        : (body as FullConversation);
  } catch (err) {
    log(`pull-compact: full GET exception: ${err instanceof Error ? err.message : err}`);
    return cachedHandoff;
  }

  const wc = (full?.working_context ?? {}) as Record<string, unknown>;
  const capturedSessionId = typeof wc.capturedSessionId === "string" ? wc.capturedSessionId : null;
  if (!capturedSessionId) {
    log("pull-compact: no capturedSessionId in working_context, can't recompute");
    return cachedHandoff;
  }

  const registry = opts.registry ?? defaultRegistry();
  const found = findLocalSession(registry, capturedSessionId, log);
  if (!found) return cachedHandoff;

  if (!found.adapter.compact) {
    log(`pull-compact: adapter "${found.adapter.tool}" has no compact()`);
    return cachedHandoff;
  }

  try {
    const result = await found.adapter.compact(found.session);
    const post = await fetch(`${apiUrl}/api/conversations/${conv.id}/compact`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ summary: result.summary, model: result.model, handoff: result.handoff }),
    });
    if (!post.ok) {
      log(`pull-compact: POST /compact returned ${post.status}`);
      return cachedHandoff;
    }
    return result.handoff ?? result.summary ?? cachedHandoff;
  } catch (err) {
    log(`pull-compact: compact failed: ${err instanceof Error ? err.message : err}`);
    return cachedHandoff;
  }
}

/**
 * Race pullHandoff against a wall-clock timer. Returns whichever resolves
 * first — null if the timer wins. The in-flight pullHandoff keeps running
 * after the timer fires so that whatever recompute work it kicked off can
 * still land on the backend (the next session will see it on its list
 * call). The timer is unref'd so it doesn't keep the process alive.
 *
 * SessionStart hooks must NOT block on a slow compact() — the hook's
 * stdout is consumed by Claude Code as part of session setup, so a 30s
 * compaction would visibly stall the user. 10s is the production budget.
 */
export async function pullHandoffWithTimeout(opts: PullHandoffOptions, timeoutMs: number): Promise<string | null> {
  const log = opts.log ?? (() => {});
  // Defensive: pullHandoff is designed not to throw, but if it ever does
  // we don't want an unhandled rejection scribbled on the daemon log.
  const work = pullHandoff(opts).catch((err) => {
    log(`pull-compact: background pull errored: ${err instanceof Error ? err.message : err}`);
    return null;
  });
  const timer = new Promise<null>((resolve) => {
    const t = setTimeout(() => {
      log(`pull-compact: timed out after ${timeoutMs}ms — emitting brief without handoff`);
      resolve(null);
    }, timeoutMs);
    // Don't keep the event loop alive for this timer; if the hook is
    // about to exit, let it exit.
    t.unref();
  });
  return Promise.race([work, timer]);
}

interface LocalSessionMatch {
  adapter: ToolAdapter;
  path: string;
  session: NonNullable<ReturnType<ToolAdapter["parse"]>>;
}

function findLocalSession(
  registry: AdapterRegistry,
  capturedSessionId: string,
  log: (msg: string) => void,
): LocalSessionMatch | null {
  for (const tool of registry.tools()) {
    const adapter = registry.get(tool);
    if (!adapter) continue;
    for (const watchDir of adapter.watchPaths()) {
      if (!fs.existsSync(watchDir)) continue;
      const candidates = scanForFiles(watchDir);
      for (const file of candidates) {
        let parsed: ReturnType<ToolAdapter["parse"]>;
        try {
          parsed = adapter.parse(file);
        } catch {
          continue;
        }
        if (parsed?.id === capturedSessionId) {
          return { adapter, path: file, session: parsed };
        }
      }
    }
  }
  log(`pull-compact: local file for session ${capturedSessionId} not found`);
  return null;
}

const SCAN_MAX_FILES = 500;

function scanForFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < SCAN_MAX_FILES) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out;
}
