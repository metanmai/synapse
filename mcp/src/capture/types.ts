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
  tool: "claude-code" | "cursor" | "codex" | "gemini" | "copilot-cli" | "cline" | "roo-code";
  projectPath: string;
  startedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  messages: SessionMessage[];
  parseErrors?: string[];
}

export interface ToolAdapter {
  tool: string;
  watchPaths(): string[];
  parse(filePath: string): CapturedSession | null;
}

/**
 * Deterministic session ID from a native tool session identifier.
 * Strips dashes and takes the first 16 characters, prefixed with "ses_".
 */
export function sessionIdFromNative(nativeId: string): string {
  const stripped = nativeId.replace(/-/g, "").slice(0, 16);
  return `ses_${stripped}`;
}

