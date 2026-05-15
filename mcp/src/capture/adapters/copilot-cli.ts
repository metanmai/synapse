import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

/**
 * Strip U+2028 (Line Separator) and U+2029 (Paragraph Separator) from a string.
 * Copilot CLI tool output may contain these raw Unicode characters which break
 * JSONL parsing since they are valid line terminators in Unicode but not in JSON.
 */
function sanitizeJsonlLine(line: string): string {
  return line.replace(/[\u2028\u2029]/g, " ");
}

export class CopilotCliAdapter implements ToolAdapter {
  tool = "copilot-cli";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".copilot", "session-state")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".jsonl")) return null;
    if (path.basename(filePath) !== "events.jsonl") return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    const messages: SessionMessage[] = [];
    const parseErrors: string[] = [];
    const pendingToolCalls: { name: string; input?: string; output?: string }[] = [];

    for (const [index, rawLine] of lines.entries()) {
      const line = sanitizeJsonlLine(rawLine);

      let event: CopilotEvent;
      try {
        event = JSON.parse(line) as CopilotEvent;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        parseErrors.push(`Line ${index + 1}: ${msg}`);
        continue;
      }

      if (!startedAt && event.timestamp) startedAt = event.timestamp;
      if (event.timestamp) updatedAt = event.timestamp;

      switch (event.type) {
        case "session.start": {
          const cwd = event.data.cwd as string | undefined;
          if (cwd && !projectPath) projectPath = cwd;
          break;
        }

        case "user.message": {
          const content = event.data.content as string | undefined;
          if (content) {
            messages.push({
              role: "user",
              content,
              timestamp: event.timestamp,
            });
          }
          break;
        }

        case "assistant.message": {
          const content = event.data.content as string | undefined;
          if (content) {
            const msg: SessionMessage = {
              role: "assistant",
              content,
              timestamp: event.timestamp,
            };
            if (pendingToolCalls.length > 0) {
              msg.toolCalls = [...pendingToolCalls];
              pendingToolCalls.length = 0;
            }
            messages.push(msg);
          }
          break;
        }

        case "tool.execution_start":
        case "tool.execution_complete": {
          const name = event.data.name as string | undefined;
          if (name) {
            const existing = pendingToolCalls.find((t) => t.name === name);
            if (existing) {
              if (event.type === "tool.execution_complete" && event.data.output) {
                existing.output = String(event.data.output);
              }
            } else {
              pendingToolCalls.push({
                name,
                input: event.data.input ? JSON.stringify(event.data.input) : undefined,
                output: event.data.output ? String(event.data.output) : undefined,
              });
            }
          }
          break;
        }

        default:
          break;
      }
    }

    const sessionDirName = path.basename(path.dirname(filePath));
    if (!sessionDirName || messages.length === 0) return null;

    return {
      id: sessionIdFromNative(sessionDirName),
      tool: "copilot-cli",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
      ...(parseErrors.length > 0 ? { parseErrors } : {}),
    };
  }
}
