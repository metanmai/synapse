import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_URL } from "../cli/config.js";
import { readProjectMap, removeProjectMapping, upsertProjectMapping } from "../cli/project-map.js";
import { type BackendResolveFn, type BackendResolveResponse, resolveProject } from "../cli/resolve-project.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import { resolveApiKey } from "./cloud-sync.js";
import { defaultRegistry } from "./default-registry.js";
import { synapseRoot } from "./handoff-paths.js";
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
  /**
   * Original working dir for hook-driven pulls. Used to resolve the project
   * via local project-map → backend resolver. Optional when `projectId` is
   * supplied directly (daemon pre-warm path) — exactly one must be set.
   */
  cwd?: string;
  /**
   * Direct project_id. Bypasses cwd resolution. The daemon pre-warm caller
   * already knows the project (it iterates `~/.synapse/projects/<id>/`), so
   * a cwd lookup would be a wasted round-trip. Mutually exclusive with `cwd`
   * in effect — when both are provided, `projectId` wins.
   */
  projectId?: string;
  apiKey?: string;
  apiUrl?: string;
  registry?: AdapterRegistry;
  log?: (msg: string) => void;
  /**
   * Fast mode for the SessionStart hook caller: when conv[0] has stale or
   * missing cached handoff, kick off the actual `claude -p` recompute in a
   * DETACHED background process and return the staleFallback (or null)
   * synchronously. The recompute can take 30-60s on a large transcript —
   * way over the hook's 10s budget — and the previous design timed out
   * inside `pullHandoffWithTimeout` before the inline await could return
   * its fallback value. Result was user-visible "first session after
   * /compact shows STATE.md only, no `## Last conversation handoff`."
   *
   * Default false preserves the original inline-await behavior used by
   * the `synapsesync pull-handoff` CLI (which IS the background process).
   */
  fast?: boolean;
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

  const auth = { Authorization: `Bearer ${apiKey}` };

  // Daemon pre-warm path: caller already knows the project (it's iterating
  // `~/.synapse/projects/<id>/`). Skip the cwd → project lookup entirely —
  // there's no cwd to canonicalize, no project-map to consult, no fallback
  // to backend resolve. This is the cheapest correct path; reverse-looking
  // up a cwd just to feed the resolver would be a wasted round-trip.
  let canonicalCwd: string | null = null;
  let projectUuid: string;
  if (opts.projectId) {
    projectUuid = opts.projectId;
  } else {
    if (!opts.cwd) {
      log("pull-compact: neither cwd nor projectId provided");
      return null;
    }
    // Canonicalize cwd so symlinked entry paths route to the same project as
    // the canonical target. cloud-sync stores project-map keys post-realpath;
    // a mismatch here would silently miss for symlink users. Falls back to
    // the raw cwd if the path no longer exists.
    canonicalCwd = opts.cwd;
    try {
      canonicalCwd = fs.realpathSync(opts.cwd);
    } catch {
      /* path gone — use raw */
    }

    // Resolve cwd → project. Local map first (fast, offline); on miss we
    // ask the backend's resolver. This is the cross-device cold-start path:
    // on a freshly installed machine the project-map is empty, and without
    // backend resolution every "first session" on a new device would silently
    // lose the handoff. The resolver only matches existing projects the user
    // can already see — it never creates one — so a true no-match still
    // returns null (caller treats null as "render the brief without handoff").
    const map = readProjectMap();
    const localMapping = map[canonicalCwd] ?? map[opts.cwd];
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
      // Map invalidation only applies on the cwd-driven path. The daemon
      // pre-warm path skips this — the daemon's project list is already
      // self-cleaning via reconcileProjects(), and there's no cwd to drop.
      if (res.status === 404 && canonicalCwd) {
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

  // 2. Prioritize the NEWEST conversation, because that's the active session.
  //    Pulling a stale handoff from an OLDER conversation would surface the
  //    wrong "where I left off" (e.g. a `claude -p` subprocess's freshly-
  //    compacted handoff outranking the main session's not-yet-compacted
  //    work). The flow per row:
  //      (a) fresh cached handoff (handoff_at >= updated_at) — return it.
  //      (b) recomputable (has capturedSessionId + local file) — try it.
  //      (c) skip; remember its handoff_markdown (if any) as a fallback.
  //    Only when conv[0] yields nothing do we fall back to OLDER rows'
  //    cached handoffs as a stale-but-better-than-nothing degradation.
  //
  //    Track the newest cached handoff among rows we walked past; if the
  //    recompute path also fails we return this rather than null. Stale
  //    handoff > no handoff (caller treats null as "render bare brief").
  let staleFallback: string | null = null;
  const conv = listed[0];
  const convMeta = (conv.metadata ?? {}) as Record<string, unknown>;
  const convCached = typeof convMeta.handoff_markdown === "string" ? convMeta.handoff_markdown : null;
  const convAt = typeof convMeta.handoff_at === "string" ? convMeta.handoff_at : null;

  // 2a. Newest has a fresh cache hit — done. The active session's handoff
  //     postdates its last message: no work added since, serve cache.
  if (convCached && convAt && convAt >= conv.updated_at) {
    log(`pull-compact: cache hit for ${conv.id}`);
    return convCached;
  }

  // 2b. Collect fallback candidates from listed[1..N] so we can degrade
  //     gracefully if the newest's recompute path fails. We prefer the
  //     newest among them — most likely to share context with the active
  //     session even if it's not the active session itself.
  if (convCached) staleFallback = convCached;
  for (const c of listed.slice(1)) {
    const m = (c.metadata ?? {}) as Record<string, unknown>;
    const cached = typeof m.handoff_markdown === "string" ? m.handoff_markdown : null;
    if (cached && !staleFallback) {
      staleFallback = cached;
      break; // first (newest) older cached handoff is the best fallback
    }
  }

  // 3. Recompute against conv[0] — the active session. This is the path
  //    that produces the actual "where I left off" for the user.
  const cachedHandoff = convCached ?? staleFallback;

  // 3a. FAST MODE shortcut. SessionStart hook can't afford the 30-60s
  //     recompute (it has a 10s budget before the brief is emitted).
  //     Spawn a detached `synapsesync pull-handoff` process for the
  //     slow recompute, then return immediately:
  //       - With cachedHandoff if we have one (fresh OR stale)
  //       - With null if not (first session in a fresh project)
  //
  //     Even when there's nothing to serve, we MUST spawn the background
  //     recompute so the NEXT session has a fresh handoff. Without this,
  //     the first new session in a fresh project would never trigger
  //     compaction — and the hook would fall through to inline recompute,
  //     hit the 10s timeout, return null anyway. Net result: two sessions
  //     in a row see bare briefs. Spawn unconditionally so the SECOND
  //     session always wins.
  if (opts.fast) {
    // Fast mode is only entered via the SessionStart hook path, which always
    // provides a cwd. Daemon pre-warm callers run in slow mode (no `fast`),
    // so this branch never executes without canonicalCwd. Defensive null-
    // guard for future callers that might combine fast + projectId.
    if (canonicalCwd) spawnBackgroundRecompute(canonicalCwd, log);
    return cachedHandoff;
  }

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
  // Force fast mode here — this wrapper is always called from the
  // SessionStart hook, which can't afford inline recompute. The fast
  // path returns staleFallback synchronously and spawns the slow
  // recompute as a detached child process, so the next session hits a
  // warm cache. Without `fast: true` the inline recompute would block
  // until either it completes (~30-60s) or the timer fires (10s default),
  // and a timer win would return null without ever using the fallback.
  const work = pullHandoff({ ...opts, fast: true }).catch((err) => {
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

/**
 * Spawn `synapsesync pull-handoff --cwd <cwd>` as a detached child process
 * so the slow recompute (claude -p, 30-60s for large transcripts) can run
 * past the parent hook's lifetime. Fire-and-forget; stderr goes to
 * ~/.synapse/pull-compact-bg.log for diagnosis.
 *
 * Without this, fast-mode pullHandoff would return staleFallback but
 * NEVER refresh the cache — every subsequent session would also see
 * stale until something else triggered the recompute. Spawning here
 * means cache freshness is bounded by recompute latency, not by user
 * activity.
 */
function spawnBackgroundRecompute(cwd: string, log: (msg: string) => void): void {
  try {
    const logFile = path.join(synapseRoot(), "pull-compact-bg.log");
    fs.mkdirSync(synapseRoot(), { recursive: true });
    const out = fs.openSync(logFile, "a");
    // The synapsesync CLI sits at dist/index.js relative to this file
    // (this file lives at dist/capture/pull-compact.js after build).
    const cliEntry = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "index.js");
    const child = child_process.spawn(process.execPath, [cliEntry, "pull-handoff", "--cwd", cwd], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, SYNAPSE_PULL_COMPACT_BG: "1" },
    });
    child.unref();
    log(`pull-compact: spawned background recompute for ${cwd} (pid=${child.pid})`);
  } catch (err) {
    log(`pull-compact: background spawn failed: ${err instanceof Error ? err.message : err}`);
  }
}
