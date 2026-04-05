import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface RooCodeMessage {
  role: string;
  content: ContentBlock[];
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
}

function extractToolCalls(content: ContentBlock[]): { name: string; input?: string }[] {
  return content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      name: c.name as string,
      input: c.input !== undefined ? JSON.stringify(c.input) : undefined,
    }));
}

function isToolResultOnly(msg: RooCodeMessage): boolean {
  return msg.role === "user" && msg.content.every((c) => c.type === "tool_result");
}

export class RooCodeAdapter implements ToolAdapter {
  tool = "roo-code";

  watchPaths(): string[] {
    const base =
      process.platform === "darwin"
        ? path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "Code",
            "User",
            "globalStorage",
            "rooveterinaryinc.roo-cline",
            "tasks",
          )
        : path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "tasks");
    return [base];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;
    if (path.basename(filePath) !== "api_conversation_history.json") return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let conversation: RooCodeMessage[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      conversation = parsed as RooCodeMessage[];
    } catch {
      return null;
    }

    if (conversation.length === 0) return null;

    const taskId = path.basename(path.dirname(filePath));
    if (!taskId) return null;

    const messages: SessionMessage[] = [];
    const now = new Date().toISOString();

    for (const msg of conversation) {
      if (!msg.role || !Array.isArray(msg.content)) continue;
      if (isToolResultOnly(msg)) continue;

      const text = extractText(msg.content);
      const toolCalls = msg.role === "assistant" ? extractToolCalls(msg.content) : [];

      if (!text && toolCalls.length === 0) continue;

      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: now,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (messages.length === 0) return null;

    let startedAt = now;
    try {
      const historyPath = path.join(path.dirname(path.dirname(filePath)), "..", "state", "taskHistory.json");
      const historyRaw = safeReadFile(historyPath);
      if (!historyRaw) throw new Error("No history file");
      const history = JSON.parse(historyRaw) as { id: string; ts: number }[];
      const match = history.find((h) => h.id === taskId);
      if (match?.ts) startedAt = new Date(match.ts).toISOString();
    } catch {
      try {
        const stat = fs.statSync(filePath);
        startedAt = stat.birthtime.toISOString();
      } catch {
        // Use now as final fallback
      }
    }

    let updatedAt = now;
    try {
      const stat = fs.statSync(filePath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      // Use now as fallback
    }

    return {
      id: sessionIdFromNative(taskId),
      tool: "roo-code",
      projectPath: "unknown",
      startedAt,
      updatedAt,
      messages,
    };
  }
}
