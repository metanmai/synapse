import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, CompactResult, SessionMessage, ToolAdapter } from "../types.js";
import { SYNAPSE_INTERNAL_MARKER, sessionIdFromNative } from "../types.js";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
}

interface ClaudeCodeLine {
  parentUuid: string | null;
  isSidechain: boolean;
  type: string;
  message: {
    role: string;
    content: string | ContentBlock[];
  };
  uuid: string;
  timestamp: string;
  sessionId?: string;
  cwd?: string;
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
}

function extractToolCalls(content: string | ContentBlock[]): { name: string; input?: string }[] {
  if (typeof content === "string") return [];
  return content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      name: c.name as string,
      input: c.input !== undefined ? JSON.stringify(c.input) : undefined,
    }));
}

export class ClaudeCodeAdapter implements ToolAdapter {
  tool = "claude-code";

  watchPaths(): string[] {
    return [path.join(os.homedir(), ".claude", "projects")];
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
    const parseErrors: string[] = [];

    for (const [index, line] of lines.entries()) {
      let parsed: ClaudeCodeLine;
      try {
        parsed = JSON.parse(line) as ClaudeCodeLine;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        parseErrors.push(`Line ${index + 1}: ${msg}`);
        continue;
      }

      if (!parsed.message?.role) continue;
      if (parsed.isSidechain) continue;

      // Skip pure tool_result messages (they are internal plumbing, not real user turns)
      if (parsed.type === "user" && parsed.message.role === "user" && Array.isArray(parsed.message.content)) {
        const isToolResult = parsed.message.content.every((c: ContentBlock) => c.type === "tool_result");
        if (isToolResult) continue;
      }

      if (!sessionId && parsed.sessionId) sessionId = parsed.sessionId;
      if (!projectPath && parsed.cwd) projectPath = parsed.cwd;
      if (!startedAt) startedAt = parsed.timestamp;
      updatedAt = parsed.timestamp;

      const text = extractText(parsed.message.content);
      const toolCalls = parsed.message.role === "assistant" ? extractToolCalls(parsed.message.content) : [];

      // Skip messages that have neither text nor tool calls
      if (!text && toolCalls.length === 0) continue;

      messages.push({
        role: parsed.message.role === "assistant" ? "assistant" : "user",
        content: text,
        timestamp: parsed.timestamp,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }

    if (!sessionId || messages.length === 0) return null;

    // Skip session files created by our own compaction spawn — the first user
    // message of those sessions starts with SYNAPSE_INTERNAL_MARKER. Otherwise
    // we'd recursively capture+compact our own summaries (and recurse forever
    // as each compaction spawn creates a new ~/.claude/projects/*.jsonl file).
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser?.content?.startsWith(SYNAPSE_INTERNAL_MARKER)) return null;

    return {
      id: sessionIdFromNative(sessionId),
      tool: "claude-code",
      projectPath: projectPath ?? "unknown",
      startedAt: startedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
      messages,
      ...(parseErrors.length > 0 ? { parseErrors } : {}),
    };
  }

  /**
   * Compact via `claude -p` running locally. Uses a locked-down config
   * profile (read-only, deny destructive tools) and `--max-turns 1` so the
   * model emits a single text reply with no follow-on tool use.
   *
   * Failure modes that throw:
   *   - `claude` not on PATH (ENOENT)
   *   - non-zero exit (network, auth, billing)
   *   - empty stdout (model returned nothing parseable)
   *
   * The transcript is truncated to ~80 KB of `role: content` text — Claude
   * Haiku's context budget comfortably handles that, and beyond it the
   * summary quality degrades. The first/last halves are preserved (middle
   * truncated) so both setup context and recent decisions survive.
   */
  async compact(session: CapturedSession): Promise<CompactResult> {
    const transcript = renderTranscript(session);
    const profile = writeCompactionProfile();
    const instruction = buildCompactionPrompt(transcript);
    return new Promise((resolve, reject) => {
      const child = child_process.spawn("claude", ["-p", instruction, "--config", profile, "--max-turns", "1"], {
        env: { ...process.env, SYNAPSE_DAEMON_SESSION: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", reject);
      child.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`claude exited ${code}: ${stderr.trim() || "(no stderr)"}`));
          return;
        }
        const summary = stdout.trim();
        if (!summary) {
          reject(new Error("claude returned empty summary"));
          return;
        }
        resolve({ summary, model: "claude-code:local-haiku" });
      });
    });
  }
}

// ─── helpers (module-scoped so tests can spy on them via the prototype) ───

const TRANSCRIPT_BUDGET_CHARS = 80_000;

function renderTranscript(session: CapturedSession): string {
  const lines = session.messages.map((m, i) => `[${i + 1}] ${m.role.toUpperCase()}: ${m.content.slice(0, 4000)}`);
  const full = lines.join("\n\n");
  if (full.length <= TRANSCRIPT_BUDGET_CHARS) return full;
  // Truncate the middle, keep first ~40% + last ~40%, mark the gap.
  const headBudget = Math.floor(TRANSCRIPT_BUDGET_CHARS * 0.4);
  const tailBudget = TRANSCRIPT_BUDGET_CHARS - headBudget - 200;
  return `${full.slice(0, headBudget)}\n\n[…transcript truncated, ${full.length - headBudget - tailBudget} chars omitted…]\n\n${full.slice(-tailBudget)}`;
}

function buildCompactionPrompt(transcript: string): string {
  return `${SYNAPSE_INTERNAL_MARKER}\nSummarize the following AI coding conversation in 3-5 short sentences focused on: what the user was working on, what decisions or learnings emerged, and what would be useful for the next session to know. Return ONLY the summary text — no headers, no preamble.\n\n---\n${transcript}\n---`;
}

function writeCompactionProfile(): string {
  const dir = path.join(os.homedir(), ".synapse");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "compaction-cc-profile.json");
  const profile = {
    permissions: {
      deny: ["Edit", "Write", "MultiEdit", "Bash", "NotebookEdit", "Agent", "WebFetch"],
      allow: ["Read"],
    },
    model: "claude-haiku-4-5-20251001",
  };
  fs.writeFileSync(p, JSON.stringify(profile, null, 2));
  return p;
}
