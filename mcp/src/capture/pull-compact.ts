import fs from "node:fs";
import path from "node:path";
import { API_URL } from "../cli/config.js";
import { readProjectMap } from "../cli/project-map.js";
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

  // The hook hands us cwd_<hash>; only the cloud syncer knows the
  // canonical project UUID, and it stashes that mapping in project-map.json
  // as a side-effect of the first successful sync.
  const map = readProjectMap();
  const mapping = map[opts.cwd];
  if (!mapping) {
    log(`pull-compact: no project-map entry for cwd=${opts.cwd}`);
    return null;
  }
  const projectUuid = mapping.project_id;

  const auth = { Authorization: `Bearer ${apiKey}` };

  // 1. Most recent conversation (listConversations orders by updated_at desc).
  let listed: ConversationListItem[];
  try {
    const res = await fetch(`${apiUrl}/api/conversations?project_id=${encodeURIComponent(projectUuid)}&limit=1`, {
      headers: auth,
    });
    if (!res.ok) {
      log(`pull-compact: list returned ${res.status}`);
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
  const conv = listed[0];
  const meta = (conv.metadata ?? {}) as Record<string, unknown>;
  const cachedHandoff = typeof meta.handoff_markdown === "string" ? meta.handoff_markdown : null;
  const handoffAt = typeof meta.handoff_at === "string" ? meta.handoff_at : null;

  // 2. Fresh? Cached handoff postdates the last message → serve cache.
  if (cachedHandoff && handoffAt && handoffAt >= conv.updated_at) {
    log(`pull-compact: cache hit for ${conv.id}`);
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
