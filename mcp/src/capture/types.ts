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
  tool: "claude-code" | "cursor" | "codex" | "gemini";
  projectPath: string;
  startedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  messages: SessionMessage[];
}

export interface ToolAdapter {
  tool: string;
  watchPaths(): string[];
  parse(filePath: string): CapturedSession | null;
}

const VALID_TOOLS = new Set(["claude-code", "cursor", "codex", "gemini"]);
const VALID_ROLES = new Set(["user", "assistant"]);

export function validateMessage(msg: unknown): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (!VALID_ROLES.has(m.role as string)) return false;
  if (typeof m.content !== "string") return false;
  if (typeof m.timestamp !== "string") return false;
  return true;
}

export function validateSession(session: unknown): boolean {
  if (typeof session !== "object" || session === null) return false;
  const s = session as Record<string, unknown>;
  if (typeof s.id !== "string") return false;
  if (!VALID_TOOLS.has(s.tool as string)) return false;
  if (typeof s.projectPath !== "string") return false;
  if (typeof s.startedAt !== "string") return false;
  if (typeof s.updatedAt !== "string") return false;
  if (!Array.isArray(s.messages) || s.messages.length === 0) return false;
  return (s.messages as unknown[]).every(validateMessage);
}
