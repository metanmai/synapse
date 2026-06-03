/**
 * Map a request's User-Agent header to a CapturedSession["tool"] tag.
 *
 * Background: the proxy is provider-aware (Anthropic / OpenAI / Google)
 * but tool-agnostic — any client that calls a recognized chat endpoint
 * gets captured. Previously, session-reconstruction.ts hardcoded every
 * captured session to tool: "claude-code" regardless of source, which
 * lied to the dashboard the moment any non-Claude-Code client used the
 * proxy. This classifier closes that gap.
 *
 * Design choices:
 *   - Pure function: takes a UA string, returns a tool tag. No I/O.
 *   - Pattern order matters: longer/more-specific patterns first so a
 *     UA like `roo-cline/1.2.3` matches `roo-code` before `cline`.
 *   - Unknown UAs return "unknown" — better than a wrong attribution.
 *     The dashboard's display map shows "Unknown tool" for these.
 *   - Each pattern is a substring/word-boundary regex; we avoid full
 *     anchored matching because many UAs prefix vendor SDK strings
 *     (e.g. `Anthropic/Python 0.7.1 cline/3.18.0`).
 */

import type { CapturedSession } from "../types.js";

type ToolTag = CapturedSession["tool"];

interface Pattern {
  match: RegExp;
  tool: ToolTag;
}

/**
 * Order matters — longer/more-specific patterns first. `roo-cline`
 * (the Roo Code fork) must match before plain `cline`. `claude-cli`
 * (the Claude Code CLI binary's UA) before bare `claude`.
 *
 * Add new tools here as they're identified. Each entry is a one-line
 * registration — no per-tool branching elsewhere in the proxy.
 */
export const USER_AGENT_PATTERNS: readonly Pattern[] = [
  // Roo Code is a Cline fork — its UA contains "roo-cline" so it must
  // come BEFORE the bare cline pattern below.
  { match: /\broo[-_]?cline\b/i, tool: "roo-code" },
  { match: /\broo[-_]?code\b/i, tool: "roo-code" },

  // Claude Code: the official CLI binary ships UA `claude-cli/<version>`.
  // We also accept "claude-code" (some integrations spell it out).
  { match: /\bclaude[-_]?cli\b/i, tool: "claude-code" },
  { match: /\bclaude[-_]?code\b/i, tool: "claude-code" },

  // Cline (VSCode extension) UA is `Cline/<version>` per their source.
  { match: /\bcline\b/i, tool: "cline" },

  // Cursor's AI integration when going direct to a provider API.
  // Cursor's Pro mode uses api.cursor.sh (not captured by the recognizer),
  // so this only fires when the user has "use my own API key" enabled.
  { match: /\bcursor\b/i, tool: "cursor" },

  // OpenAI's codex-cli ships UA `codex-cli/<version>`.
  { match: /\bcodex[-_]?cli\b/i, tool: "codex" },
  { match: /\bcodex\b/i, tool: "codex" },

  // Google's gemini-cli ships UA `gemini-cli/<version>` or `Google-AI-CLI`.
  { match: /\bgemini[-_]?cli\b/i, tool: "gemini" },
  { match: /\bgemini\b/i, tool: "gemini" },

  // GitHub Copilot CLI ships UA `gh-copilot/<version>` or
  // `copilot-cli/<version>`.
  { match: /\bcopilot[-_]?cli\b/i, tool: "copilot-cli" },
  { match: /\bgh[-_]?copilot\b/i, tool: "copilot-cli" },
];

/**
 * Classify a User-Agent string into a tool tag.
 *
 * Returns `"unknown"` when:
 *   - `ua` is undefined / null / empty
 *   - no pattern matches (e.g. a tool we haven't registered yet)
 *
 * The dashboard's display map renders `"unknown"` as "Unknown tool" so
 * users can spot uncaptured-attribution patterns and request adapter
 * additions.
 */
export function classifyUserAgent(ua: string | undefined | null): ToolTag {
  if (!ua) return "unknown";
  for (const pattern of USER_AGENT_PATTERNS) {
    if (pattern.match.test(ua)) return pattern.tool;
  }
  return "unknown";
}
