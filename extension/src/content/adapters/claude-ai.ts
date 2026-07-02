import type { CaptureAdapter, CapturedTurn } from "./types.js";

// POST /api/organizations/{org}/chat_conversations/{conv}/completion (SSE).
const COMPLETION_RE = /\/chat_conversations\/[^/]+\/completion\b/;

/**
 * Reassemble the assistant turn from claude.ai's completion SSE. The web app
 * speaks the documented Anthropic Messages streaming format —
 * message_start / content_block_delta(text_delta) / message_stop — so the reply
 * is the concatenation of every `text_delta.text` across `data:` events.
 */
export function parseClaudeResponse(responseText: string): CapturedTurn | null {
  let text = "";
  for (const line of responseText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: unknown } };
      if (
        evt.type === "content_block_delta" &&
        evt.delta?.type === "text_delta" &&
        typeof evt.delta.text === "string"
      ) {
        text += evt.delta.text;
      }
    } catch {
      /* non-JSON data line — ignore */
    }
  }
  return text ? { role: "assistant", content: text } : null;
}

/**
 * Extract the user turn from the completion REQUEST body. The new message is
 * `prompt` on claude.ai's web shape; we fall back to the last `user` entry in a
 * `messages` array. Reads conversation content only — never headers/cookies.
 */
export function parseClaudeRequest(body: unknown): CapturedTurn | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { prompt?: unknown; messages?: unknown };
  if (typeof b.prompt === "string" && b.prompt.trim()) return { role: "user", content: b.prompt };
  if (Array.isArray(b.messages)) {
    for (let i = b.messages.length - 1; i >= 0; i--) {
      const m = b.messages[i] as { role?: unknown; content?: unknown };
      if (m?.role !== "user") continue;
      if (typeof m.content === "string" && m.content.trim()) return { role: "user", content: m.content };
      if (Array.isArray(m.content)) {
        const joined = m.content
          .filter((c): c is { type: "text"; text: string } => {
            const cc = c as { type?: unknown; text?: unknown };
            return cc.type === "text" && typeof cc.text === "string";
          })
          .map((c) => c.text)
          .join("\n");
        if (joined) return { role: "user", content: joined };
      }
    }
  }
  return null;
}

export const claudeAdapter: CaptureAdapter = {
  host: "claude.ai",
  matchesCompletion: (url) => COMPLETION_RE.test(url),
  parseRequest: parseClaudeRequest,
  parseResponse: parseClaudeResponse,
};
