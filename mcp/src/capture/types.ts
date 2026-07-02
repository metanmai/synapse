export interface ToolCall {
  name: string;
  input?: string;
  output?: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
  toolCalls?: ToolCall[];
}

export interface CapturedSession {
  id: string;
  tool:
    | "claude-code"
    | "cursor"
    | "codex"
    | "gemini"
    | "copilot-cli"
    | "cline"
    | "roo-code"
    | "opencode"
    | "crush"
    | "claude-ai"
    | "chatgpt"
    | "unknown";
  projectPath: string;
  startedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  messages: SessionMessage[];
  parseErrors?: string[];
}

/**
 * Marker prepended to internal Synapse-spawned `claude -p` (or equivalent)
 * invocations so adapters can recognize and skip those session files instead
 * of recursively capturing + compacting them. Adapters with a `compact()`
 * method MUST filter out sessions whose first user message starts with this
 * marker.
 */
export const SYNAPSE_INTERNAL_MARKER = "[SYNAPSE_INTERNAL_COMPACTION]";

export interface CompactResult {
  /**
   * Short prose description for the dashboard — 3-5 sentences, human-facing.
   * Stored in `conversations.compacted_summary`.
   */
  summary: string;
  /**
   * Structured markdown handoff document for the NEXT agent that picks up
   * this work — sections for task, state, next action, decisions, files,
   * open questions, gotchas, last user prompt. Read by a fresh Claude Code
   * session (or any agent) instead of re-deriving context from the
   * transcript. Stored in `conversations.metadata.handoff_markdown` (JSON
   * column — no schema migration needed).
   *
   * Optional: an adapter may produce only a description if its `compact()`
   * implementation hasn't been extended to handoff format yet.
   */
  handoff?: string;
  /**
   * Tag identifying the local source — e.g. `"claude-code:local-haiku"`.
   * Persisted on the conversation row so the dashboard can attribute the
   * summary back to the local CLI vs the backend's hosted compaction.
   */
  model: string;
}

export interface ToolAdapter {
  tool: string;
  watchPaths(): string[];
  parse(filePath: string): CapturedSession | null;
  /**
   * Optional: compact a captured session via this tool's local one-shot CLI
   * (e.g., `claude -p` for Claude Code). Cost shifts from Synapse's hosted
   * LLM to the user's own subscription, and transcripts never leave the
   * user's machine for a separate LLM endpoint.
   *
   * Adapters whose tools lack a usable one-shot mode should omit this; the
   * caller falls back to the backend's server-side compaction path.
   *
   * Failure (CLI missing, exit non-zero, etc.) should reject — the caller
   * decides whether to retry or surface a degraded mode.
   */
  compact?(session: CapturedSession): Promise<CompactResult>;
}

/**
 * Deterministic session ID from a native tool session identifier.
 * Strips dashes and takes the first 16 characters, prefixed with "ses_".
 */
export function sessionIdFromNative(nativeId: string): string {
  const stripped = nativeId.replace(/-/g, "").slice(0, 16);
  return `ses_${stripped}`;
}
