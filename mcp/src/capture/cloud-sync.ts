import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "../cli/config.js";
import { upsertProjectMapping } from "../cli/project-map.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "./types.js";

interface SyncState {
  cloudConversationId: string;
  lastSyncedMessageCount: number;
}

interface Project {
  id: string;
  name: string;
}

function resolveApiKey(): string | null {
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
  return readKeyFromMcpJson(homeConfig);
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
  private syncStates = new Map<string, SyncState>();
  private projectId: string | null = null;
  private projectName: string | null = null;
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.apiKey = resolveApiKey();
    this.log = log ?? (() => {});

    if (!this.apiKey) {
      this.log("Cloud sync disabled: no API key found");
    }
  }

  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Sync a session to the cloud, optionally compacting it via the tool's
   * local CLI on first creation.
   *
   * @param session — parsed transcript from an adapter
   * @param adapter — the same adapter that parsed the session. When the
   *                  adapter exposes `compact()`, we call it after the first
   *                  successful sync and POST the resulting summary to the
   *                  backend's `/compact` endpoint. The transcript never
   *                  leaves the user's machine for a hosted LLM.
   *                  Passing `undefined` (or an adapter without `compact`)
   *                  skips local compaction and falls back to whatever the
   *                  user / dashboard triggers server-side.
   */
  async sync(session: CapturedSession, adapter?: ToolAdapter): Promise<boolean> {
    if (!this.apiKey) return false;

    try {
      const projectId = await this.resolveProjectId();
      if (!projectId) return false;

      const existing = this.syncStates.get(session.id);

      if (existing) {
        // Subsequent sync -- only append new messages
        const newMessages = session.messages.slice(existing.lastSyncedMessageCount);
        if (newMessages.length === 0) return true; // Nothing new

        const ok = await this.appendMessages(existing.cloudConversationId, newMessages);
        if (ok) {
          existing.lastSyncedMessageCount = session.messages.length;
          this.updateProjectMap(session.projectPath, projectId);
        }
        return ok;
      }

      // First sync -- create conversation and push all messages
      const conversationId = await this.createConversation(projectId, session);
      if (!conversationId) return false;

      const ok = await this.appendMessages(conversationId, session.messages);
      if (ok) {
        this.syncStates.set(session.id, {
          cloudConversationId: conversationId,
          lastSyncedMessageCount: session.messages.length,
        });
        this.updateProjectMap(session.projectPath, projectId);

        // Local-CLI compaction (non-blocking for sync success). If the
        // adapter supports compaction via its tool's one-shot mode, fire it
        // and POST the result. Failure here does NOT fail the overall sync —
        // the conversation already landed on the backend and the dashboard
        // can fall back to the hosted compaction path.
        if (adapter?.compact) {
          try {
            this.log(`Local-CLI compaction starting for ${conversationId} (${session.messages.length} msgs)`);
            const result = await adapter.compact(session);
            const posted = await this.uploadCompactionSummary(
              conversationId,
              result.summary,
              result.model,
              result.handoff,
            );
            this.log(
              `Local-CLI compaction ${posted ? "stored" : "POST failed"} for ${conversationId} (handoff=${result.handoff ? "yes" : "no"})`,
            );
          } catch (err) {
            this.log(`Local-CLI compaction failed for ${conversationId}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      return ok;
    } catch (err) {
      this.log(`Cloud sync error for ${session.id}: ${err}`);
      return false;
    }
  }

  private async uploadCompactionSummary(
    conversationId: string,
    summary: string,
    model: string,
    handoff?: string,
  ): Promise<boolean> {
    try {
      const body: Record<string, string> = { summary, model };
      if (handoff && handoff.length > 0) body.handoff = handoff;
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}/compact`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.log(`Compact-summary POST returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (err) {
      this.log(`Compact-summary POST exception: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  private async resolveProjectId(): Promise<string | null> {
    if (this.projectId) return this.projectId;

    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        headers: this.authHeaders(),
      });

      if (!res.ok) {
        this.log(`Failed to fetch projects: ${res.status}`);
        return null;
      }

      const projects = (await res.json()) as Project[];
      if (projects.length > 0) {
        this.projectId = projects[0].id;
        this.projectName = projects[0].name;
        return this.projectId;
      }

      this.log("No projects found, cannot sync");
      return null;
    } catch (err) {
      this.log(`Failed to resolve project: ${err}`);
      return null;
    }
  }

  private async createConversation(projectId: string, session: CapturedSession): Promise<string | null> {
    try {
      // Build working_context with cwd and optional git_origin_url
      const workingContext: Record<string, string> = {
        tool: session.tool,
        projectPath: session.projectPath,
        cwd: session.projectPath,
        capturedSessionId: session.id,
      };

      try {
        const url = execSync("git config --get remote.origin.url", {
          cwd: session.projectPath,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
        if (url) {
          workingContext.git_origin_url = url;
        }
      } catch {
        // Not a git repo or no remote — omit git_origin_url
      }

      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          project_id: projectId,
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

      const data = (await res.json()) as { id: string };
      return data.id;
    } catch (err) {
      this.log(`Failed to create conversation: ${err}`);
      return null;
    }
  }

  private async appendMessages(conversationId: string, messages: SessionMessage[]): Promise<boolean> {
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
        return false;
      }

      return true;
    } catch (err) {
      this.log(`Failed to append messages: ${err}`);
      return false;
    }
  }

  private updateProjectMap(projectPath: string, projectId: string): void {
    try {
      if (this.projectName) {
        upsertProjectMapping(projectPath, {
          project_id: projectId,
          project_name: this.projectName,
        });
      }
    } catch {
      /* map is best-effort cache; never fail a sync for it */
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}
