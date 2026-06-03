import { describe, expect, it } from "vitest";
import { classifyUserAgent } from "../../../src/capture/proxy/user-agent-classify.js";

describe("classifyUserAgent", () => {
  // ── Recognized tools (positive cases) ─────────────────────────────────────

  it.each([
    ["claude-cli/1.0.0", "claude-code"],
    ["claude-code/2.4.1", "claude-code"],
    ["Anthropic/JS 0.20.0 claude-cli/0.99.0", "claude-code"],
    ["Cline/3.18.0", "cline"],
    ["cline/3.18.0 Anthropic/Python 0.30.0", "cline"],
    ["roo-cline/2.0.0", "roo-code"],
    ["RooCode/1.5.0", "roo-code"],
    ["Cursor/0.45.0", "cursor"],
    ["codex-cli/0.5.0", "codex"],
    ["openai-codex/0.5.0", "codex"],
    ["gemini-cli/1.0.0", "gemini"],
    ["Gemini/2.0", "gemini"],
    ["gh-copilot/1.2.3", "copilot-cli"],
    ["copilot-cli/0.9.0", "copilot-cli"],
  ])("classifies %q → %q", (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });

  // ── Boundary: roo-cline must match roo-code BEFORE cline ──────────────────

  it("classifies roo-cline as roo-code (not cline)", () => {
    expect(classifyUserAgent("roo-cline/2.0.0")).toBe("roo-code");
  });

  it("classifies roo_code as roo-code (underscore variant)", () => {
    expect(classifyUserAgent("roo_code/1.0.0")).toBe("roo-code");
  });

  it("classifies claude-cli before falling through to claude-code", () => {
    // Both patterns map to the same tool, but claude-cli appears first
    // in the table so it'll match the more-specific variant.
    expect(classifyUserAgent("claude-cli/0.99.0")).toBe("claude-code");
  });

  // ── Unknown / edge cases ─────────────────────────────────────────────────

  it("returns unknown for undefined UA", () => {
    expect(classifyUserAgent(undefined)).toBe("unknown");
  });

  it("returns unknown for null UA", () => {
    expect(classifyUserAgent(null)).toBe("unknown");
  });

  it("returns unknown for empty string", () => {
    expect(classifyUserAgent("")).toBe("unknown");
  });

  it("returns unknown for a UA we haven't registered", () => {
    expect(classifyUserAgent("aider-chat/0.45.0")).toBe("unknown");
  });

  it("returns unknown for a raw SDK UA without a tool wrapper", () => {
    expect(classifyUserAgent("Anthropic/Python 0.30.0")).toBe("unknown");
  });

  it("returns unknown for curl / wget / similar generic clients", () => {
    expect(classifyUserAgent("curl/8.0.0")).toBe("unknown");
    expect(classifyUserAgent("Wget/1.21.4")).toBe("unknown");
  });

  it("returns unknown for browsers", () => {
    expect(classifyUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("unknown");
  });

  // ── Case-insensitivity ───────────────────────────────────────────────────

  it("matches case-insensitively", () => {
    expect(classifyUserAgent("CLAUDE-CLI/1.0.0")).toBe("claude-code");
    expect(classifyUserAgent("CLINE/3.0.0")).toBe("cline");
    expect(classifyUserAgent("Cursor/1.0.0")).toBe("cursor");
  });

  // ── Word boundary: substrings of unrelated tokens don't match ────────────

  it("does NOT classify when the tool name appears only as a fragment", () => {
    // "cursory" should NOT match "cursor" — word boundary required.
    expect(classifyUserAgent("cursory/1.0.0")).toBe("unknown");
    // "geminiscope" should NOT match "gemini".
    expect(classifyUserAgent("geminiscope/1.0.0")).toBe("unknown");
  });

  it("DOES classify when separated by hyphens or non-word chars", () => {
    expect(classifyUserAgent("anthropic-python-cline-0.30.0")).toBe("cline");
  });

  // ── Realistic combined UA strings ────────────────────────────────────────

  it("classifies a real-world Cline UA (with vendor SDK prefix)", () => {
    expect(classifyUserAgent("Anthropic/JS 0.27.0 Cline/3.18.5")).toBe("cline");
  });

  it("classifies a real-world Claude Code UA", () => {
    // The actual Claude Code CLI ships something like this.
    expect(classifyUserAgent("claude-cli/1.0.84 (darwin; arm64) node/24.0.0")).toBe("claude-code");
  });
});
