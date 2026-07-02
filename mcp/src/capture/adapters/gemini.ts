import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

// Gemini's session-file format changed between major versions. We accept
// both so capture works regardless of which gemini-cli release is on
// PATH.
//
//   v1 (older gemini-cli): single .json file with a top-level chat
//   object — { id, messages: [...], createdAt, updatedAt }. Detect by
//   .json extension.
//
//   v2 (current gemini-cli, observed 0.45+): JSONL files under
//   ~/.gemini/tmp/<project>/chats/session-*.jsonl. Each line is
//   either a session_meta object ({sessionId, startTime, kind:"main"})
//   or a `$set` delta containing the full messages array up to that
//   point (idempotent state snapshots). Last `$set` wins.
//
// Detection is per-file by extension: .json → v1, .jsonl → v2. Same
// dual-format pattern the codex adapter uses for codex 0.4x vs 0.50+.

interface GeminiContentV1 {
  type: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

interface GeminiMessageV1 {
  id: string;
  role: string;
  content: GeminiContentV1[];
  timestamp: string;
}

interface GeminiChatV1 {
  id: string;
  messages: GeminiMessageV1[];
  createdAt: string;
  updatedAt: string;
  projectHash?: string;
}

interface GeminiContentBlockV2 {
  text?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

interface GeminiMessageV2 {
  id?: string;
  timestamp?: string;
  type?: string; // "user" | "model" | "assistant"
  role?: string;
  content: GeminiContentBlockV2[];
}

interface GeminiMetaLineV2 {
  sessionId: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  kind?: string;
}

interface GeminiSetLineV2 {
  $set?: {
    messages?: GeminiMessageV2[];
    lastUpdated?: string;
  };
}

/** Flatten v2's content-block array into a single string. */
function extractTextV2(blocks: GeminiContentBlockV2[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b): b is GeminiContentBlockV2 & { text: string } => typeof b?.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function extractToolCallsV2(blocks: GeminiContentBlockV2[] | undefined) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((b): b is GeminiContentBlockV2 & { toolName: string } => typeof b?.toolName === "string")
    .map((b) => ({
      name: b.toolName,
      input: b.input ? JSON.stringify(b.input) : undefined,
      output: b.output ? JSON.stringify(b.output) : undefined,
    }));
}

export class GeminiAdapter implements ToolAdapter {
  tool = "gemini";

  watchPaths(): string[] {
    const override = process.env.SYNAPSE_TEST_GEMINI_PATH;
    if (override) return [override];
    return [path.join(os.homedir(), ".gemini", "tmp")];
  }

  parse(filePath: string): CapturedSession | null {
    if (filePath.endsWith(".jsonl")) return this.parseV2(filePath);
    if (filePath.endsWith(".json")) return this.parseV1(filePath);
    return null;
  }

  /** v1: single JSON document with messages[]. */
  private parseV1(filePath: string): CapturedSession | null {
    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let chat: GeminiChatV1;
    try {
      chat = JSON.parse(raw) as GeminiChatV1;
    } catch {
      return null;
    }

    if (!chat.id || !chat.messages) return null;

    const messages: SessionMessage[] = [];

    for (const msg of chat.messages) {
      const text = msg.content
        .filter((c): c is GeminiContentV1 & { text: string } => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");

      if (!text) continue;

      const toolCalls = msg.content
        .filter(
          (c): c is GeminiContentV1 & { toolName: string } => c.type === "tool_use" && typeof c.toolName === "string",
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

  /**
   * v2: JSONL where the first line is session_meta and subsequent lines
   * are `$set` deltas. Each `$set.messages` is a FULL snapshot up to
   * that point — not a patch — so we keep the LAST `$set.messages`
   * we see, not an accumulated merge. That matches gemini-cli's
   * actual write pattern (rewrite the full message list on every
   * turn). If we accumulated, we'd duplicate every prior message.
   */
  private parseV2(filePath: string): CapturedSession | null {
    const raw = safeReadFile(filePath);
    if (!raw) return null;

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let sessionId: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    let latestMessages: GeminiMessageV2[] = [];

    for (const line of lines) {
      let parsed: GeminiMetaLineV2 & GeminiSetLineV2;
      try {
        parsed = JSON.parse(line) as GeminiMetaLineV2 & GeminiSetLineV2;
      } catch {
        continue;
      }

      if (typeof parsed.sessionId === "string" && !sessionId) {
        sessionId = parsed.sessionId;
        if (parsed.startTime) startedAt = parsed.startTime;
      }
      if (parsed.lastUpdated) updatedAt = parsed.lastUpdated;

      if (parsed.$set?.messages && Array.isArray(parsed.$set.messages)) {
        latestMessages = parsed.$set.messages;
        if (parsed.$set.lastUpdated) updatedAt = parsed.$set.lastUpdated;
      }
    }

    if (!sessionId) return null;

    const messages: SessionMessage[] = [];
    for (const msg of latestMessages) {
      const text = extractTextV2(msg.content);
      if (!text) continue;
      const roleSource = msg.type ?? msg.role ?? "user";
      const toolCalls = extractToolCallsV2(msg.content);
      messages.push({
        role: roleSource === "model" || roleSource === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: msg.timestamp ?? updatedAt ?? new Date().toISOString(),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (messages.length === 0) return null;

    return {
      id: sessionIdFromNative(sessionId),
      tool: "gemini",
      projectPath: "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? startedAt ?? new Date().toISOString(),
      messages,
    };
  }
}
