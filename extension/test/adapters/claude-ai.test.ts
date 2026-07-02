import { describe, expect, it } from "vitest";
import { claudeAdapter, parseClaudeRequest, parseClaudeResponse } from "../../src/content/adapters/claude-ai.js";
import claudeFixture from "./fixtures/claude-completion.json";

// Assemble a faithful claude.ai completion SSE from the captured delta pieces,
// encoding each event exactly as the web app does (JSON.stringify the payload).
function buildSSE(deltas: string[]): string {
  const events = deltas.map(
    (text) =>
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })}`,
  );
  const all = [
    'event: message_start\ndata: {"type":"message_start"}',
    ...events,
    'event: message_stop\ndata: {"type":"message_stop"}',
  ];
  return `${all.join("\n\n")}\n`;
}

describe("claude-ai adapter", () => {
  it("matchesCompletion only on the completion endpoint", () => {
    expect(claudeAdapter.matchesCompletion("/api/organizations/abc/chat_conversations/xyz/completion")).toBe(true);
    // numbered-endpoint drift seen live (2026-06): /completion → /completion2
    expect(claudeAdapter.matchesCompletion("/api/organizations/abc/chat_conversations/xyz/completion2")).toBe(true);
    expect(claudeAdapter.matchesCompletion("/api/organizations/abc/chat_conversations/xyz/completion10")).toBe(true);
    expect(claudeAdapter.matchesCompletion("/api/organizations/abc/chat_conversations/xyz")).toBe(false);
    expect(claudeAdapter.matchesCompletion("/api/organizations/abc/chat_conversations/xyz/completionfoo")).toBe(false);
    expect(claudeAdapter.matchesCompletion("/api/account")).toBe(false);
  });

  it("reassembles the assistant turn from the real completion SSE (golden)", () => {
    const turn = parseClaudeResponse(buildSSE(claudeFixture.deltas));
    expect(turn).not.toBeNull();
    expect(turn?.role).toBe("assistant");
    expect(turn?.content).toBe(claudeFixture.expectedAssistant);
  });

  it("ignores non-delta events and returns null with no text", () => {
    expect(parseClaudeResponse('event: ping\ndata: {"type":"ping"}\n')).toBeNull();
  });

  it("extracts the user turn from a request prompt", () => {
    expect(parseClaudeRequest({ prompt: "say hello" })).toEqual({ role: "user", content: "say hello" });
  });

  it("falls back to the last user message in a messages array", () => {
    const body = {
      messages: [
        { role: "assistant", content: "hi" },
        { role: "user", content: "and then?" },
      ],
    };
    expect(parseClaudeRequest(body)).toEqual({ role: "user", content: "and then?" });
  });
});
