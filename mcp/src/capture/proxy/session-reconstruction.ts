/**
 * Pure-function reconstruction of CapturedSessions from a stream of
 * proxy-captured HTTP requests.
 *
 * INPUT  — array of CapturedRequest, one per HTTP request the proxy saw.
 *          May include non-chat requests (telemetry, etc.) — those are
 *          filtered out internally.
 * OUTPUT — array of CapturedSession matching the format the rest of
 *          Synapse already consumes (CloudSyncer, project routing, etc.).
 *
 * Bug class this guards:
 * ─────────────────────
 *   "The daemon's session-reconstruction conflates two different
 *    conversations into one — OR splits one into many — OR captures
 *    telemetry as if it were a session."
 *
 * Specific scenarios from the proxy-feasibility spike:
 *   1. claude CLI fires 3× /v1/messages with identical messages[0]
 *      for a single user prompt (retries). Must collapse to ONE session.
 *   2. Same first message ~10 min later is a NEW session (user
 *      resumed an old conversation in a fresh context).
 *   3. The 30+ telemetry / registry / settings calls per session must
 *      never become CapturedSessions — `endpoint.capture: false` is
 *      the gate.
 *
 * Algorithm (high-level):
 *   1. Filter to only chat endpoints with 2xx status.
 *   2. Group consecutive requests by (first-message hash + temporal
 *      proximity). Different first message → new group. Same first
 *      message but past idle window → new group.
 *   3. For each group, take the LAST request as authoritative — its
 *      messages array is the longest (continuations grow it) and its
 *      response is the latest (retries supersede).
 *   4. Extract per-provider messages from (request body + response body)
 *      into the canonical SessionMessage[] shape.
 *
 * Known limitations (acceptable for v1, documented for future):
 *   - Conversation FORKS (two requests that share the same prefix but
 *     diverge on a non-last user turn) merge into one session reflecting
 *     only the LAST request. Rare in practice; documented.
 *   - Two distinct conversations that share an identical first message
 *     within the idle window WILL be conflated. Acceptable because the
 *     pattern is bizarre (same prompt twice in <5 min).
 */

import { createHash } from "node:crypto";
import type { CapturedSession, SessionMessage, ToolCall } from "../types.js";
import type { CapturedRequest, ReconstructionOptions } from "./types.js";

const DEFAULT_IDLE_MS = 5 * 60 * 1000;

/**
 * Convert a stream of proxy-captured HTTP requests into CapturedSession
 * objects ready to be pushed via CloudSyncer.
 *
 * @param requests  Captured request/response pairs, in arrival order
 * @param opts      Idle window, tool tagging
 * @returns         Zero or more CapturedSessions
 */
export function reconstructSessions(
  requests: CapturedRequest[],
  opts: ReconstructionOptions & { tool?: CapturedSession["tool"] } = {},
): CapturedSession[] {
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  // Tool tagging: at this layer we don't know which client (claude CLI,
  // codex, cursor) produced the request — only the upstream provider.
  // Default to claude-code as the most common observed client; later
  // slices will refine via User-Agent header inspection.
  const tool = opts.tool ?? "claude-code";

  // Stage 1: filter to chat-capturable, 2xx requests only. Telemetry,
  // registry, metrics, embeddings, etc. drop here.
  const capturable = requests.filter((r) => r.endpoint.capture && r.statusCode >= 200 && r.statusCode < 300);

  if (capturable.length === 0) return [];

  // Stage 2: group by (first-message hash + idle window).
  const groups: CapturedRequest[][] = [];
  for (const req of capturable) {
    const hash = firstMessageHash(req);
    if (hash === null) continue; // body didn't have a recognizable first message

    const lastGroup = groups[groups.length - 1];
    if (lastGroup) {
      const lastReq = lastGroup[lastGroup.length - 1];
      const lastHash = firstMessageHash(lastReq);
      const dt = new Date(req.timestamp).getTime() - new Date(lastReq.timestamp).getTime();
      if (lastHash === hash && dt < idleMs) {
        lastGroup.push(req);
        continue;
      }
    }
    groups.push([req]);
  }

  // Stage 3: collapse each group to a CapturedSession.
  const sessions: CapturedSession[] = [];
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const hash = firstMessageHash(first);
    if (hash === null) continue;

    const messages = extractMessages(last);
    if (messages.length === 0) continue;

    sessions.push({
      id: `ses_${hash}`,
      tool,
      // Project routing happens at the proxy server's working-context
      // layer (a later slice). At this pure-function layer we don't
      // know the cwd — emit "unknown" and let the proxy server fill
      // it in before pushing to CloudSyncer.
      projectPath: "unknown",
      startedAt: first.timestamp,
      updatedAt: last.timestamp,
      messages,
    });
  }

  return sessions;
}

/**
 * Stable hash of the first user message in a request. Used to detect
 * "same conversation, more turns" (continuation) vs "different
 * conversation" (new session).
 *
 * Two requests share a session iff their firstMessageHash matches AND
 * they're within the idle window. Returns null if the first message
 * can't be identified (malformed body, unknown provider).
 */
function firstMessageHash(req: CapturedRequest): string | null {
  const text = extractFirstMessageText(req);
  if (text === null) return null;
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function extractFirstMessageText(req: CapturedRequest): string | null {
  const provider = req.endpoint.provider;
  if (provider === "anthropic") return anthropicFirstMessageText(req.requestBody);
  if (provider === "openai") return openaiFirstMessageText(req.requestBody);
  if (provider === "google") return googleFirstMessageText(req.requestBody);
  return null;
}

function extractMessages(req: CapturedRequest): SessionMessage[] {
  const provider = req.endpoint.provider;
  if (provider === "anthropic") return anthropicMessages(req);
  if (provider === "openai") return openaiMessages(req);
  if (provider === "google") return googleMessages(req);
  return [];
}

// ── Anthropic ────────────────────────────────────────────────────────────

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id?: string;
  name: string;
  input?: unknown;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string };
interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}
interface AnthropicRequestBody {
  messages?: AnthropicMessage[];
}
interface AnthropicResponseBody {
  role?: string;
  content?: AnthropicContentBlock[];
}

function anthropicFirstMessageText(body: unknown): string | null {
  const b = body as AnthropicRequestBody;
  const first = b.messages?.[0];
  if (!first) return null;
  const text = anthropicMessageText(first);
  if (!text) return null;
  // Include role in hash so role flips can't accidentally conflate.
  return `${first.role}:${text}`;
}

function anthropicMessageText(msg: AnthropicMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter((c): c is AnthropicTextBlock => c.type === "text" && typeof (c as AnthropicTextBlock).text === "string")
    .map((c) => c.text)
    .join("\n");
}

function anthropicToolCalls(msg: AnthropicMessage): ToolCall[] {
  if (!Array.isArray(msg.content)) return [];
  return msg.content
    .filter(
      (c): c is AnthropicToolUseBlock => c.type === "tool_use" && typeof (c as AnthropicToolUseBlock).name === "string",
    )
    .map((c) => ({
      name: c.name,
      input: c.input !== undefined ? JSON.stringify(c.input) : undefined,
    }));
}

function anthropicMessages(req: CapturedRequest): SessionMessage[] {
  const reqBody = req.requestBody as AnthropicRequestBody;
  const resBody = req.responseBody as AnthropicResponseBody;
  const out: SessionMessage[] = [];

  for (const m of reqBody.messages ?? []) {
    const text = anthropicMessageText(m);
    const toolCalls = m.role === "assistant" ? anthropicToolCalls(m) : [];
    if (!text && toolCalls.length === 0) continue;
    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: text,
      timestamp: req.timestamp,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }

  // The response is the LATEST assistant turn — append it as the final
  // message in the session.
  if (resBody?.content) {
    const responseAsMsg: AnthropicMessage = { role: "assistant", content: resBody.content };
    const text = anthropicMessageText(responseAsMsg);
    const toolCalls = anthropicToolCalls(responseAsMsg);
    if (text || toolCalls.length > 0) {
      out.push({
        role: "assistant",
        content: text,
        timestamp: req.timestamp,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }
  }

  return out;
}

// ── OpenAI ───────────────────────────────────────────────────────────────

interface OpenAIMessage {
  role: string;
  content: string | null;
}
interface OpenAIRequestBody {
  messages?: OpenAIMessage[];
}
interface OpenAIChoice {
  message?: OpenAIMessage;
}
interface OpenAIResponseBody {
  choices?: OpenAIChoice[];
}

function openaiFirstMessageText(body: unknown): string | null {
  const b = body as OpenAIRequestBody;
  const first = b.messages?.[0];
  if (!first) return null;
  const text = typeof first.content === "string" ? first.content : "";
  if (!text) return null;
  return `${first.role}:${text}`;
}

function openaiMessages(req: CapturedRequest): SessionMessage[] {
  const reqBody = req.requestBody as OpenAIRequestBody;
  const resBody = req.responseBody as OpenAIResponseBody;
  const out: SessionMessage[] = [];

  for (const m of reqBody.messages ?? []) {
    const content = typeof m.content === "string" ? m.content : "";
    if (!content) continue;
    // OpenAI's roles include system, user, assistant, tool. Map to our
    // user/assistant binary; system messages are still useful context
    // so tag them as user-side preamble.
    const role: SessionMessage["role"] = m.role === "assistant" ? "assistant" : "user";
    out.push({ role, content, timestamp: req.timestamp });
  }

  // Latest assistant message from the choices[0].
  const assistantContent = resBody?.choices?.[0]?.message?.content;
  if (typeof assistantContent === "string" && assistantContent) {
    out.push({ role: "assistant", content: assistantContent, timestamp: req.timestamp });
  }

  return out;
}

// ── Google ───────────────────────────────────────────────────────────────

interface GooglePart {
  text?: string;
}
interface GoogleContent {
  role?: string;
  parts?: GooglePart[];
}
interface GoogleRequestBody {
  contents?: GoogleContent[];
}
interface GoogleCandidate {
  content?: GoogleContent;
}
interface GoogleResponseBody {
  candidates?: GoogleCandidate[];
}

function googleFirstMessageText(body: unknown): string | null {
  const b = body as GoogleRequestBody;
  const first = b.contents?.[0];
  if (!first) return null;
  const text = googleContentText(first);
  if (!text) return null;
  // Google uses 'user' / 'model' role strings; canonicalize to our shape
  // for hashing stability.
  const role = first.role === "model" ? "assistant" : "user";
  return `${role}:${text}`;
}

function googleContentText(c: GoogleContent): string {
  return (c.parts ?? [])
    .map((p) => p.text ?? "")
    .filter((t) => t)
    .join("\n");
}

function googleMessages(req: CapturedRequest): SessionMessage[] {
  const reqBody = req.requestBody as GoogleRequestBody;
  const resBody = req.responseBody as GoogleResponseBody;
  const out: SessionMessage[] = [];

  for (const c of reqBody.contents ?? []) {
    const text = googleContentText(c);
    if (!text) continue;
    out.push({
      role: c.role === "model" ? "assistant" : "user",
      content: text,
      timestamp: req.timestamp,
    });
  }

  const candidateContent = resBody?.candidates?.[0]?.content;
  if (candidateContent) {
    const text = googleContentText(candidateContent);
    if (text) {
      out.push({ role: "assistant", content: text, timestamp: req.timestamp });
    }
  }

  return out;
}
