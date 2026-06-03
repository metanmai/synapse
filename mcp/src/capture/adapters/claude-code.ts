import child_process from "node:child_process";
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
   * Compact via `claude -p` running locally.
   *
   * Prompt strategy (the first iteration of this got it wrong — Haiku was
   * just echoing the last assistant turn instead of summarizing — so the
   * structure here is deliberate):
   *
   *   1. `--system-prompt` carries the role + the strict "do not respond /
   *      do not continue" constraint. System prompts are load-bearing for
   *      instruction-following; cramming the instruction into the user
   *      message lost the priority fight against 100+ messages of dense
   *      transcript content.
   *
   *   2. Transcript uses neutral speaker labels (`Developer:` / `Helper:`)
   *      wrapped in `<transcript_to_summarize>` XML tags. Claude is trained
   *      to treat XML-tagged content as data rather than instructions, and
   *      neutral labels don't trigger the "your turn next" continuation
   *      prior that `USER:`/`ASSISTANT:` does.
   *
   *   3. Post-validation: reject obvious continuation outputs (output that
   *      starts with the last Helper turn, or is way longer than expected).
   *      Fallback path on the server still applies.
   *
   * Flag choices (verified against `claude --help` in v1.x):
   *   --system-prompt: replaces Claude's default system prompt entirely.
   *   --no-session-persistence: don't write the compaction session to disk.
   *   --tools "": no tool use needed for a text summary.
   *   --model claude-haiku-4-5-20251001: cheap + fast.
   */
  async compact(session: CapturedSession): Promise<CompactResult> {
    const transcript = renderTranscript(session);
    const systemPrompt = buildSystemPrompt();
    const userMessage = buildUserMessage(transcript);
    const lastHelperHead = extractLastHelperHead(session);

    return new Promise((resolve, reject) => {
      const child = child_process.spawn(
        "claude",
        [
          "-p",
          userMessage,
          "--system-prompt",
          systemPrompt,
          "--no-session-persistence",
          "--tools",
          "",
          "--model",
          "claude-haiku-4-5-20251001",
        ],
        {
          env: { ...process.env, SYNAPSE_DAEMON_SESSION: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
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
        // Reject obvious continuations: output that starts with the same
        // first ~60 characters as the last assistant turn in the transcript.
        // This was the actual failure mode on the Sunshine conversation —
        // Haiku output the last message verbatim instead of summarizing.
        if (lastHelperHead && summary.startsWith(lastHelperHead)) {
          reject(new Error("compaction looks like a continuation of the conversation, not a summary"));
          return;
        }
        // Reject obviously-too-long outputs (3-5 sentences max should be
        // well under 2000 chars even with generous interpretation).
        if (summary.length > 4000) {
          reject(new Error(`compaction exceeded 4000 chars (${summary.length}); likely echoing transcript`));
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
  // Neutral speaker labels — `Developer:` / `Helper:` — so Haiku doesn't
  // see the structure as a chat it should continue. The labels themselves
  // don't appear in Claude's continuation-trigger token patterns the way
  // `USER:` / `ASSISTANT:` do.
  const lines = session.messages.map((m, i) => {
    const speaker = m.role === "user" ? "Developer" : "Helper";
    return `${speaker} (turn ${i + 1}): ${m.content.slice(0, 4000)}`;
  });
  const full = lines.join("\n\n");
  if (full.length <= TRANSCRIPT_BUDGET_CHARS) return full;
  // Truncate the middle, keep first ~40% + last ~40%, mark the gap.
  const headBudget = Math.floor(TRANSCRIPT_BUDGET_CHARS * 0.4);
  const tailBudget = TRANSCRIPT_BUDGET_CHARS - headBudget - 200;
  return `${full.slice(0, headBudget)}\n\n[…transcript truncated, ${full.length - headBudget - tailBudget} chars omitted…]\n\n${full.slice(-tailBudget)}`;
}

function extractLastHelperHead(session: CapturedSession): string | null {
  // First 60 chars of the last Helper (assistant) turn — used by post-
  // validation to reject obvious "Claude continued the conversation
  // instead of summarizing it" outputs.
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === "assistant" && m.content) {
      const head = m.content.trim().slice(0, 60);
      return head.length >= 20 ? head : null;
    }
  }
  return null;
}

function buildSystemPrompt(): string {
  // Heavy system prompt deliberately — instruction-following on long
  // user messages needs the constraint to live OUTSIDE the user message,
  // otherwise it gets drowned by 100+ turns of transcript content.
  return [
    "You are a conversation summarizer. The user's next message will contain a transcript of a prior AI coding session between a Developer and a Helper, wrapped in <transcript_to_summarize> tags.",
    "",
    "Your ONLY job is to produce a short summary of that transcript. Specifically:",
    "  - 3 to 5 sentences total",
    "  - Cover what the developer was working on, key decisions or learnings that emerged, and what would help a future session pick up",
    "  - Plain prose; no markdown headers, no bullet lists, no preamble like 'Here is a summary:'",
    "",
    "Hard constraints — these are not optional:",
    "  - Do NOT respond to questions in the transcript",
    "  - Do NOT continue the conversation as the Helper",
    "  - Do NOT include verbatim text from the transcript longer than a short phrase",
    "  - Do NOT preface or postface the summary with anything",
    "",
    "Output: only the summary text itself.",
  ].join("\n");
}

function buildUserMessage(transcript: string): string {
  // SYNAPSE_INTERNAL_MARKER stays as belt-and-suspenders defense — if
  // --no-session-persistence ever regresses, the adapter's parse() still
  // filters out marker-tagged sessions.
  return `${SYNAPSE_INTERNAL_MARKER}\n<transcript_to_summarize>\n${transcript}\n</transcript_to_summarize>\n\nProduce the summary now.`;
}
