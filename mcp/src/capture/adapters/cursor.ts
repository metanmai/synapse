import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface CursorRequest {
  requestId: string;
  message: { text: string };
  response?: { value: string }[];
  timestamp: number;
}

interface CursorChat {
  requests: CursorRequest[];
  sessionId: string;
  creationDate: number;
  lastMessageDate: number;
}

export class CursorAdapter implements ToolAdapter {
  tool = "cursor";

  watchPaths(): string[] {
    const base = path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage");
    return [base];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let chat: CursorChat;
    try {
      chat = JSON.parse(raw) as CursorChat;
    } catch {
      return null;
    }

    if (!chat.requests || !chat.sessionId) return null;

    const messages: SessionMessage[] = [];

    for (const req of chat.requests) {
      const userText = req.message?.text;
      if (!userText) continue;

      messages.push({
        role: "user",
        content: userText,
        timestamp: new Date(req.timestamp).toISOString(),
      });

      const responseText = req.response?.map((r) => r.value).join("\n");
      if (responseText) {
        messages.push({
          role: "assistant",
          content: responseText,
          timestamp: new Date(req.timestamp).toISOString(),
        });
      }
    }

    if (messages.length === 0) return null;

    const parts = filePath.split(path.sep);
    const wsIdx = parts.indexOf("workspaceStorage");
    const projectPath = wsIdx >= 0 ? parts.slice(0, wsIdx).join(path.sep) : "unknown";

    return {
      id: sessionIdFromNative(chat.sessionId),
      tool: "cursor",
      projectPath,
      startedAt: new Date(chat.creationDate).toISOString(),
      updatedAt: new Date(chat.lastMessageDate).toISOString(),
      messages,
    };
  }
}
