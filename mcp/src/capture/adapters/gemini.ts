import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface GeminiContent {
  type: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

interface GeminiMessage {
  id: string;
  role: string;
  content: GeminiContent[];
  timestamp: string;
}

interface GeminiChat {
  id: string;
  messages: GeminiMessage[];
  createdAt: string;
  updatedAt: string;
  projectHash?: string;
}

export class GeminiAdapter implements ToolAdapter {
  tool = "gemini";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".gemini", "tmp")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let chat: GeminiChat;
    try {
      chat = JSON.parse(raw) as GeminiChat;
    } catch {
      return null;
    }

    if (!chat.id || !chat.messages) return null;

    const messages: SessionMessage[] = [];

    for (const msg of chat.messages) {
      const text = msg.content
        .filter((c): c is GeminiContent & { text: string } => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");

      if (!text) continue;

      const toolCalls = msg.content
        .filter(
          (c): c is GeminiContent & { toolName: string } => c.type === "tool_use" && typeof c.toolName === "string",
        )
        .map((c) => ({
          name: c.toolName,
          input: c.input ? JSON.stringify(c.input) : undefined,
          output: c.output ? JSON.stringify(c.output) : undefined,
        }));

      messages.push({
        role: msg.role === "model" ? "assistant" : "user",
        content: text,
        timestamp: msg.timestamp,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (messages.length === 0) return null;

    return {
      id: sessionIdFromNative(chat.id),
      tool: "gemini",
      projectPath: "unknown",
      startedAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages,
    };
  }
}
