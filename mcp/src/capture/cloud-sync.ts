import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "../cli/config.js";
import type { CapturedSession, SessionMessage } from "./types.js";

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

  async sync(session: CapturedSession): Promise<boolean> {
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
      }
      return ok;
    } catch (err) {
      this.log(`Cloud sync error for ${session.id}: ${err}`);
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
      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          project_id: projectId,
          title: `[${session.tool}] ${session.projectPath.split("/").pop() ?? "session"} — ${session.startedAt}`,
          fidelity_mode: "full",
          system_prompt: null,
          working_context: {
            tool: session.tool,
            projectPath: session.projectPath,
            capturedSessionId: session.id,
          },
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

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}
