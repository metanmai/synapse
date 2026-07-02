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
    const userMessage = buildUserMessage(transcript);
    const lastHelperHead = extractLastHelperHead(session);

    // Two parallel calls — one for the short human-facing description,
    // one for the structured agent handoff. Same transcript, different
    // system prompts. Doubles the per-conversation cost but each call is
    // independent and they overlap; wall-clock latency is ~max(call1, call2),
    // not sum.
    const [summary, handoff] = await Promise.all([
      runClaude(userMessage, buildDescriptionSystemPrompt(), lastHelperHead, /*maxChars*/ 4000),
      runClaude(userMessage, buildHandoffSystemPrompt(), lastHelperHead, /*maxChars*/ 8000),
    ]);

    return { summary, handoff, model: "claude-code:local-haiku" };
  }
}

// ─── claude -p invocation + shared validation ───

function runClaude(
  userMessage: string,
  systemPrompt: string,
  lastHelperHead: string | null,
  maxChars: number,
): Promise<string> {
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
      const out = stdout.trim();
      if (!out) {
        reject(new Error("claude returned empty output"));
        return;
      }
      // Reject obvious continuations: output starts with the last assistant
      // turn — the Sunshine bug. Catches both the description and handoff
      // calls in case either prompt regresses.
      if (lastHelperHead && out.startsWith(lastHelperHead)) {
        reject(new Error("compaction output looks like a conversation continuation, not a summary/handoff"));
        return;
      }
      if (out.length > maxChars) {
        reject(new Error(`compaction output exceeded ${maxChars} chars (${out.length}); likely echoing transcript`));
        return;
      }
      resolve(out);
    });
  });
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

function buildDescriptionSystemPrompt(): string {
  // System prompt for the HUMAN-FACING short description shown on the
  // dashboard. Concise prose, 3-5 sentences. This is the "at-a-glance"
  // view; the agent handoff is generated separately.
  return [
    "You are a conversation summarizer. The user's next message will contain a transcript of a prior AI coding session between a Developer and a Helper, wrapped in <transcript_to_summarize> tags.",
    "",
    "Your ONLY job is to produce a short prose summary of that transcript for a HUMAN reader scanning a dashboard. Specifically:",
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

function buildHandoffSystemPrompt(): string {
  // System prompt for the AGENT-FACING structured handoff document. This
  // is what the next Claude Code (or any agent) session reads to pick up
  // where the prior one left off — like /compact's context-replacement
  // output, but stored persistently on the conversation row.
  //
  // Designed by the agent (me) for the agent (next me) — bullets over
  // prose, imperative voice, sections omitted rather than padded.
  return [
    "You are producing an OPERATIONAL HANDOFF for a fresh AI coding agent (Claude Code or similar) that will pick up the work in this conversation. The user's next message will contain the transcript wrapped in <transcript_to_summarize> tags.",
    "",
    "The next agent will read your output and resume work. They do not have the transcript itself — only your handoff. So pack it with what they need to act, not what they need to understand.",
    "",
    "Output a markdown document using these sections, in this order. OMIT any section that genuinely doesn't apply rather than padding it with 'N/A':",
    "",
    "## Task",
    "One line stating the goal the developer is working toward right now.",
    "",
    "## State",
    "Where things stand at the end of this conversation. 2-4 lines. Be specific about: what's done, what's mid-flight, what's blocked, what's been merged/committed/deployed if relevant.",
    "",
    "## Next action",
    "The single specific thing the next agent should do FIRST. Specific enough to execute without re-asking the developer. Imperative voice.",
    "",
    "## Then",
    "Ordered list of 2-5 follow-on steps. Skip this section entirely if 'Next action' is the only obvious next move or if further steps depend on its result.",
    "",
    "## Decisions",
    "Bulleted list — each item: `decision — one-line rationale`. Cover decisions the developer or prior agent made that the next agent must honor (not relitigate). Skip if no notable decisions.",
    "",
    "## Files in play",
    "Bulleted list — each item: \\`path/to/file\\` — one-line role in this work. Use backticks around paths. Skip if none touched.",
    "",
    "## Open questions",
    "Bulleted list of things that NEED HUMAN INPUT to resolve — questions the next agent should NOT try to answer alone. Skip if none. This is explicitly not for things the agent can figure out.",
    "",
    "## Gotchas",
    "Bulleted list of non-obvious watch-outs (failure modes, surprising behavior, traps). Skip if none.",
    "",
    "## Last user prompt",
    "Verbatim or near-verbatim quote of the developer's most recent message, formatted as a blockquote (> at start of line). Skip if the most recent message was a system/tool notification rather than a user prompt.",
    "",
    "Output rules:",
    "  - Markdown only, no preamble or postface (no 'Here is the handoff:')",
    "  - Use backticks around file paths, function names, identifiers, CLI commands",
    "  - Bullets over prose; imperative voice in actions",
    "  - Total length: aim for 1500-3500 characters. Compactness is a feature.",
    "  - Skip sections that don't apply, don't pad",
    "  - Do NOT respond to the conversation, do NOT continue it as the Helper",
  ].join("\n");
}

function buildUserMessage(transcript: string): string {
  // SYNAPSE_INTERNAL_MARKER stays as belt-and-suspenders defense — if
  // --no-session-persistence ever regresses, the adapter's parse() still
  // filters out marker-tagged sessions. The same user message is sent
  // to both the description call and the handoff call; the system prompt
  // differs and controls the output shape.
  return `${SYNAPSE_INTERNAL_MARKER}\n<transcript_to_summarize>\n${transcript}\n</transcript_to_summarize>\n\nProduce the output now.`;
}
