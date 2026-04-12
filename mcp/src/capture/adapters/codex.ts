import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";

interface CodexLine {
  type: string;
  timestamp: string;
  role?: string;
  content?: string;
  session_id?: string;
  name?: string;
  input?: string;
  output?: string;
  model?: string;
  cwd?: string;
  tokens?: { input: number; output: number };
}

export class CodexAdapter implements ToolAdapter {
  tool = "codex";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".codex", "sessions")];
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
    const pendingToolCalls: { name: string; input?: string; output?: string }[] = [];

    for (const line of lines) {
      let parsed: CodexLine;
      try {
        parsed = JSON.parse(line) as CodexLine;
      } catch {
        continue;
      }

      if (!sessionId && parsed.session_id) sessionId = parsed.session_id;
      if (!projectPath && parsed.cwd) projectPath = parsed.cwd;
      if (!startedAt && parsed.timestamp) startedAt = parsed.timestamp;
      if (parsed.timestamp) updatedAt = parsed.timestamp;

      if (parsed.type === "message" && parsed.role && parsed.content) {
        const msg: SessionMessage = {
          role: parsed.role === "assistant" ? "assistant" : "user",
          content: parsed.content,
          timestamp: parsed.timestamp,
        };
        if (parsed.role === "assistant" && pendingToolCalls.length > 0) {
          msg.toolCalls = [...pendingToolCalls];
          pendingToolCalls.length = 0;
        }
        messages.push(msg);
      } else if (parsed.type === "tool_call" && parsed.name) {
        pendingToolCalls.push({ name: parsed.name, input: parsed.input, output: parsed.output });
      }
    }

    if (!sessionId || messages.length === 0) return null;

    return {
      id: sessionId,
      tool: "codex",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
    };
  }
}
