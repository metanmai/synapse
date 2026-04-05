import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
}

interface ClaudeCodeLine {
  parentUuid: string | null;
  isSidechain: boolean;
  type: string;
  message: {
    role: string;
    content: string | ContentBlock[];
  };
  uuid: string;
  timestamp: string;
  sessionId?: string;
  cwd?: string;
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
}

function extractToolCalls(content: string | ContentBlock[]): { name: string; input?: string }[] {
  if (typeof content === "string") return [];
  return content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      name: c.name as string,
      input: c.input !== undefined ? JSON.stringify(c.input) : undefined,
    }));
}

export class ClaudeCodeAdapter implements ToolAdapter {
  tool = "claude-code";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".claude", "projects")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".jsonl")) return null;
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let sessionId: string | null = null;
    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    const messages: SessionMessage[] = [];

    for (const line of lines) {
      let parsed: ClaudeCodeLine;
      try {
        parsed = JSON.parse(line) as ClaudeCodeLine;
      } catch {
        continue;
      }

      if (!parsed.message?.role) continue;
      if (parsed.isSidechain) continue;

      // Skip pure tool_result messages (they are internal plumbing, not real user turns)
      if (parsed.type === "user" && parsed.message.role === "user" && Array.isArray(parsed.message.content)) {
        const isToolResult = parsed.message.content.every((c: ContentBlock) => c.type === "tool_result");
        if (isToolResult) continue;
      }

      if (!sessionId && parsed.sessionId) sessionId = parsed.sessionId;
      if (!projectPath && parsed.cwd) projectPath = parsed.cwd;
      if (!startedAt) startedAt = parsed.timestamp;
      updatedAt = parsed.timestamp;

      const text = extractText(parsed.message.content);
      const toolCalls = parsed.message.role === "assistant" ? extractToolCalls(parsed.message.content) : [];

      // Skip messages that have neither text nor tool calls
      if (!text && toolCalls.length === 0) continue;

      messages.push({
        role: parsed.message.role === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: parsed.timestamp,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (!sessionId || messages.length === 0) return null;

    return {
      id: sessionId,
      tool: "claude-code",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
    };
  }
}
