import type { CaptureAdapter, CapturedTurn } from "./types.js";

// POST /backend-api/conversation (SSE). NOTE: built against the documented
// ChatGPT wire shape; the real sample was deferred to release smoke (Task 16),
// so this parser is tolerant of both the cumulative-`parts` and delta-`append`
// streaming variants.
const COMPLETION_RE = /\/backend-api\/(?:f\/)?conversation\b/;

interface ChatGPTEvent {
  message?: { author?: { role?: unknown }; content?: { parts?: unknown } };
  o?: unknown;
  p?: unknown;
  v?: unknown;
}

export function parseChatGPTResponse(responseText: string): CapturedTurn | null {
  let cumulative = ""; // classic: each event carries the full text so far
  let appended = ""; // delta variant: {o:"append", p:".../parts/0", v:"..."}
  for (const line of responseText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let evt: unknown;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== "object") continue;
    const e = evt as ChatGPTEvent;

    // Old snapshot format: {message: {author: {role}, content: {parts}}}
    const snapParts = e.message?.content?.parts;
    if (e.message?.author?.role === "assistant" && Array.isArray(snapParts)) {
      const text = snapParts.filter((p): p is string => typeof p === "string").join("");
      if (text.length >= cumulative.length) cumulative = text; // snapshots grow → keep latest
    }

    // New "add" format: {o:"add", v: {message: {author: {role}, content: {parts}}}}
    if (e.o === "add" && e.v && typeof e.v === "object") {
      const msg = (e.v as { message?: ChatGPTEvent["message"] }).message;
      const addParts = msg?.content?.parts;
      if (msg?.author?.role === "assistant" && Array.isArray(addParts)) {
        const text = addParts.filter((p): p is string => typeof p === "string").join("");
        if (text.length >= cumulative.length) cumulative = text;
      }
    }

    // New "patch" format: {o:"patch", v:[{p:"/message/content/parts/0", o:"append", v:"text"}]}
    if (e.o === "patch" && Array.isArray(e.v)) {
      for (const op of e.v as Array<{ p?: unknown; o?: unknown; v?: unknown }>) {
        if (op.p === "/message/content/parts/0" && op.o === "append" && typeof op.v === "string") {
          appended += op.v;
        }
      }
    }

    // Legacy delta format: {o:"append", p:".../parts/0", v:"..."}
    if (typeof e.v === "string" && (e.o === "append" || typeof e.p === "undefined" || String(e.p).includes("parts"))) {
      appended += e.v;
    }
  }
  const content = cumulative.length >= appended.length ? cumulative : appended;
  return content ? { role: "assistant", content } : null;
}

export function parseChatGPTRequest(body: unknown): CapturedTurn | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { messages?: unknown };
  if (!Array.isArray(b.messages)) return null;
  for (let i = b.messages.length - 1; i >= 0; i--) {
    const m = b.messages[i] as { author?: { role?: unknown }; role?: unknown; content?: unknown };
    const role = m?.author?.role ?? m?.role;
    if (role !== "user") continue;
    const content = m?.content as { parts?: unknown } | string | undefined;
    if (content && typeof content === "object" && Array.isArray(content.parts)) {
      const t = content.parts.filter((p): p is string => typeof p === "string").join("\n");
      if (t) return { role: "user", content: t };
    }
    if (typeof content === "string" && content.trim()) return { role: "user", content };
  }
  return null;
}

export const chatgptAdapter: CaptureAdapter = {
  host: "chatgpt.com",
  matchesCompletion: (url) => COMPLETION_RE.test(url),
  parseRequest: parseChatGPTRequest,
  parseResponse: parseChatGPTResponse,
};
