import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

// Codex's session-file format changed between major versions. We accept
// both so a fresh `codex` install captures regardless of which release
// the user has on PATH.
//
//   v1 (codex 0.4x and earlier): flat lines.
//     {"type":"session_meta","session_id":"...","cwd":"...","timestamp":"..."}
//     {"type":"message","role":"user","content":"Hello","timestamp":"..."}
//     {"type":"tool_call","name":"Bash","input":"...","output":"..."}
//
//   v2 (codex 0.50+): every line wraps real fields in `payload`,
//   `response_item` replaces `message`, and content is an array of
//   typed blocks (input_text / output_text / image_url / …).
//     {"type":"session_meta","payload":{"id":"...","cwd":"...","timestamp":"..."}}
//     {"type":"response_item","payload":{"type":"message","role":"user",
//        "content":[{"type":"input_text","text":"Hello"}]}}
//
// Detection is per-line, not per-file, because hypothetical mixed-version
// files (e.g. logs concatenated by a tool) still parse correctly: a line
// with a `payload` object is v2; everything else is v1.
interface CodexLineV1 {
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

interface CodexContentBlock {
  type: string;
  text?: string;
}

interface CodexLineV2 {
  type: string;
  timestamp: string;
  payload?: {
    // session_meta
    id?: string;
    cwd?: string;
    timestamp?: string;
    // response_item (type="message")
    role?: string;
    content?: CodexContentBlock[] | string;
    // response_item (type="function_call" — codex's assistant tool call)
    name?: string;
    arguments?: string;
    call_id?: string;
    // response_item (type="function_call_output")
    output?: string;
    // payload's own discriminator (e.g. "message" | "function_call")
    type?: string;
  };
}

/** Flatten v2's content-block array into a single string. */
function extractTextV2(content: CodexContentBlock[] | string | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block.text === "string" && (block.type === "input_text" || block.type === "output_text")) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

export class CodexAdapter implements ToolAdapter {
  tool = "codex";

  watchPaths(): string[] {
    const override = process.env.SYNAPSE_TEST_CODEX_PATH;
    if (override) return [override];
    return [path.join(os.homedir(), ".codex", "sessions")];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".jsonl")) return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    let sessionId: string | null = null;
    let projectPath: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    const messages: SessionMessage[] = [];
    const pendingToolCalls: { name: string; input?: string; output?: string }[] = [];
    const parseErrors: string[] = [];

    for (const [index, line] of lines.entries()) {
      let parsed: CodexLineV1 & CodexLineV2;
      try {
        parsed = JSON.parse(line) as CodexLineV1 & CodexLineV2;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        parseErrors.push(`Line ${index + 1}: ${msg}`);
        continue;
      }

      // Discriminate v2 from v1 per-line. A non-null `payload` object
      // is the v2 marker.
      const v2payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload : null;

      // Common fields — same precedence as the original parser: the
      // session inherits its id / cwd / start from the FIRST occurrence,
      // and updatedAt walks forward with every timestamped line.
      if (parsed.timestamp) updatedAt = parsed.timestamp;

      if (v2payload) {
        // ── v2 (codex 0.50+) ────────────────────────────────────────
        if (!sessionId && v2payload.id) sessionId = v2payload.id;
        if (!projectPath && v2payload.cwd) projectPath = v2payload.cwd;
        if (!startedAt && (parsed.timestamp || v2payload.timestamp)) {
          startedAt = parsed.timestamp ?? v2payload.timestamp ?? null;
        }

        // Only response_item lines with payload.type === "message" are
        // actual conversation turns. event_msg / turn_context lines are
        // UI / config noise and would duplicate / fragment messages.
        if (parsed.type === "response_item" && v2payload.type === "message" && v2payload.role) {
          const text = extractTextV2(v2payload.content);
          if (text) {
            const msg: SessionMessage = {
              role: v2payload.role === "assistant" ? "assistant" : "user",
              content: text,
              timestamp: parsed.timestamp,
            };
            if (v2payload.role === "assistant" && pendingToolCalls.length > 0) {
              msg.toolCalls = [...pendingToolCalls];
              pendingToolCalls.length = 0;
            }
            messages.push(msg);
          }
        } else if (parsed.type === "response_item" && v2payload.type === "function_call" && v2payload.name) {
          // Codex's v2 assistant tool calls are response_items of
          // type=function_call. Buffer until the next assistant message
          // — same shape v1's tool_call followed.
          pendingToolCalls.push({
            name: v2payload.name,
            input: v2payload.arguments,
            // function_call_output lines arrive separately; we don't try
            // to match them up here because the call_id-based plumbing
            // adds parse cost for little downstream benefit.
            output: undefined,
          });
        }
      } else {
        // ── v1 (codex 0.4x and earlier) ─────────────────────────────
        if (!sessionId && parsed.session_id) sessionId = parsed.session_id;
        if (!projectPath && parsed.cwd) projectPath = parsed.cwd;
        if (!startedAt && parsed.timestamp) startedAt = parsed.timestamp;

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
    }

    if (!sessionId || messages.length === 0) return null;

    return {
      id: sessionIdFromNative(sessionId),
      tool: "codex",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
      ...(parseErrors.length > 0 ? { parseErrors } : {}),
    };
  }
}
