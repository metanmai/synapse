import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "../cli/config.js";
import { removeProjectMapping, upsertProjectMapping } from "../cli/project-map.js";
import { synapseRoot } from "./handoff-paths.js";
import { type SyncState, loadSyncStates, saveSyncStates } from "./sync-state-store.js";
import type { CapturedSession, SessionMessage } from "./types.js";

export function resolveApiKey(): string | null {
  // 1. Environment variable
  const envKey = process.env.SYNAPSE_API_KEY;
  if (envKey && envKey !== "undefined") {
    return envKey;
  }

  // 2. .mcp.json in cwd
  const cwdConfig = path.join(process.cwd(), ".mcp.json");
  const key = readKeyFromMcpJson(cwdConfig);
  if (key) return key;

  // 3. ~/.mcp.json
  const homeConfig = path.join(os.homedir(), ".mcp.json");
  const homeKey = readKeyFromMcpJson(homeConfig);
  if (homeKey) return homeKey;

  // 4. ~/.synapse/config.json — the canonical location written by
  //    `synapse init`. Hooks fire from arbitrary project directories with
  //    no local .mcp.json, so falling back to the daemon's config is what
  //    lets pull-compact reach the API at all.
  return readKeyFromSynapseConfig();
}

function readKeyFromSynapseConfig(): string | null {
  try {
    const p = path.join(synapseRoot(), "config.json");
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    const v = raw?.api_key;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function readKeyFromMcpJson(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return raw?.mcpServers?.synapse?.env?.SYNAPSE_API_KEY ?? null;
  } catch {
    return null;
  }
}

function mapMessages(messages: SessionMessage[]): Array<{
  role: string;
  content: string;
  tool_interaction: { name: string; summary: string } | null;
  source_agent: string;
  source_model: string | null;
}> {
  return messages.map((msg) => {
    let toolInteraction: { name: string; summary: string } | null = null;
    if (msg.toolCalls?.length) {
      const first = msg.toolCalls[0];
      toolInteraction = {
        name: first.name,
        summary: msg.toolCalls.length > 1 ? `${first.name} + ${msg.toolCalls.length - 1} more` : first.name,
      };
    }

    return {
      role: msg.role,
      content: msg.content,
      tool_interaction: toolInteraction,
      source_agent: "capture-daemon",
      source_model: null,
    };
  });
}

export class CloudSyncer {
  private apiKey: string | null;
  private syncStates: Map<string, SyncState>;
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.apiKey = resolveApiKey();
    this.log = log ?? (() => {});
    // Restore the conversation-id ↔ session-id map from disk so that a daemon
    // restart doesn't recreate a fresh /api/conversations row for a session
    // that's already on the backend. Any corruption / missing file silently
    // starts fresh (worst case: we recreate one conversation, same as before
    // this commit).
    this.syncStates = loadSyncStates(this.log);

    if (!this.apiKey) {
      this.log("Cloud sync disabled: no API key found");
    }
  }

  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Sync a session to the cloud. Just pushes messages — compaction is owned
   * by the pull path (handoff-brief / SessionStart), not by this hot loop.
   *
   * Per-cwd routing: each captured session creates (or appends to) a
   * conversation on the backend. The conversation's project is determined
   * server-side from working_context.git_origin_url + cwd basename via the
   * shared findOrCreateProjectByGit helper — this is the same auto-create
   * flow that the events-batch route uses, so a session captured in
   * /path/to/repo lands in the SAME project as that repo's handoff events.
   */
  async sync(session: CapturedSession): Promise<boolean> {
    if (!this.apiKey) return false;

    // Canonicalize once at the top so the project-map key and the routing
    // signals sent to the backend always agree. If we canonicalized only
    // inside createConversation but stored the project-map under the raw
    // path, pull-compact's later cwd lookup would miss.
    let canonicalPath = session.projectPath;
    try {
      canonicalPath = fs.realpathSync(session.projectPath);
    } catch {
      /* dir gone — use recorded path */
    }

    try {
      const existing = this.syncStates.get(session.id);

      if (existing) {
        const newMessages = session.messages.slice(existing.lastSyncedMessageCount);
        if (newMessages.length === 0) return true;

        const result = await this.appendMessages(existing.cloudConversationId, newMessages);
        if (result.ok) {
          existing.lastSyncedMessageCount = session.messages.length;
          saveSyncStates(this.syncStates, this.log);
          if (existing.projectId) {
            this.updateProjectMap(canonicalPath, existing.projectId, existing.projectName ?? null);
          }
          return true;
        }

        // 404 means the conversation was deleted server-side (synapse
        // reset, dashboard delete, account wipe). The cached cloud id is
        // dead — wipe state and retry as a first-sync via createConversation.
        // Any other non-ok status (401, 5xx, network) we treat as transient
        // and leave the cache intact so the next sync retries.
        if (result.status === 404) {
          this.log(`Stale sync state for ${session.id} (cloud conv ${existing.cloudConversationId} 404) — re-creating`);
          this.syncStates.delete(session.id);
          // Project might also have been deleted — drop the map entry so
          // pull-compact doesn't keep pointing at a dead UUID either.
          if (existing.projectId) this.removeProjectMapEntry(canonicalPath, existing.projectId);
          saveSyncStates(this.syncStates, this.log);
          // Fall through to first-sync path below.
        } else {
          return false;
        }
      }

      const created = await this.createConversation(session);
      if (!created) return false;

      const appended = await this.appendMessages(created.id, session.messages);
      if (appended.ok) {
        this.syncStates.set(session.id, {
          cloudConversationId: created.id,
          lastSyncedMessageCount: session.messages.length,
          projectId: created.project_id,
          projectName: created.project_name,
        });
        saveSyncStates(this.syncStates, this.log);
        this.updateProjectMap(canonicalPath, created.project_id, created.project_name);
      }
      return appended.ok;
    } catch (err) {
      this.log(`Cloud sync error for ${session.id}: ${err}`);
      return false;
    }
  }

  private async createConversation(session: CapturedSession): Promise<{
    id: string;
    project_id: string;
    project_name: string | null;
  } | null> {
    try {
      // Resolve symlinks so a user who entered claude via `~/work/proj`
      // (symlinked to `~/Documents/proj`) and another who entered via the
      // target directly route to the SAME backend project. Falls back to
      // session.projectPath if the dir no longer exists.
      let canonicalProjectPath = session.projectPath;
      try {
        canonicalProjectPath = fs.realpathSync(session.projectPath);
      } catch {
        /* dir gone — use the recorded path as-is */
      }
      const workingContext: Record<string, string> = {
        tool: session.tool,
        projectPath: canonicalProjectPath,
        cwd: canonicalProjectPath,
        capturedSessionId: session.id,
      };

      try {
        const url = execSync("git config --get remote.origin.url", {
          cwd: canonicalProjectPath,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
        if (url) {
          workingContext.git_origin_url = url;
        }
      } catch {
        // Not a git repo or no remote — omit git_origin_url. Backend falls
        // back to basename match.
      }

      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          // Intentionally NO project_id — backend auto-routes via
          // working_context.git_origin_url + cwd basename.
          title: `[${session.tool}] ${session.projectPath.split("/").pop() ?? "session"} — ${session.startedAt}`,
          fidelity_mode: "full",
          system_prompt: null,
          working_context: workingContext,
        }),
      });

      if (!res.ok) {
        this.log(`Failed to create conversation: ${res.status}`);
        return null;
      }

      // Response is the full Conversation row — includes the resolved
      // project_id (filled in by the backend's auto-routing when we sent
      // none) and the project_name when the backend embedded it.
      const data = (await res.json()) as {
        id: string;
        project_id: string;
        project_name?: string | null;
      };
      return {
        id: data.id,
        project_id: data.project_id,
        project_name: data.project_name ?? null,
      };
    } catch (err) {
      this.log(`Failed to create conversation: ${err}`);
      return null;
    }
  }

  private async appendMessages(
    conversationId: string,
    messages: SessionMessage[],
  ): Promise<{ ok: boolean; status: number }> {
    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          messages: mapMessages(messages),
        }),
      });

      if (!res.ok) {
        this.log(`Failed to append messages: ${res.status}`);
        return { ok: false, status: res.status };
      }

      return { ok: true, status: res.status };
    } catch (err) {
      this.log(`Failed to append messages: ${err}`);
      // Network error — pretend the conversation is unreachable but NOT
      // gone, so we don't wipe the cache on transient blips.
      return { ok: false, status: 0 };
    }
  }

  private updateProjectMap(projectPath: string, projectId: string, projectName: string | null): void {
    try {
      upsertProjectMapping(projectPath, {
        project_id: projectId,
        project_name: projectName ?? projectPath.split("/").pop() ?? "untitled",
      });
    } catch {
      /* map is best-effort cache; never fail a sync for it */
    }
  }

  private removeProjectMapEntry(projectPath: string, projectIdHint: string): void {
    removeProjectMapping(projectPath, projectIdHint);
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}
