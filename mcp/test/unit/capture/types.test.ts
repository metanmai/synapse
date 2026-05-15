import { describe, expect, it } from "vitest";
import { validateMessage, validateSession } from "../../../src/capture/types.js";

describe("validateMessage", () => {
  it("accepts a valid user message", () => {
    const msg = { role: "user" as const, content: "hello", timestamp: "2026-04-02T10:00:00Z" };
    expect(validateMessage(msg)).toBe(true);
  });

  it("accepts a valid assistant message with tool calls", () => {
    const msg = {
      role: "assistant" as const,
      content: "I'll read that file",
      timestamp: "2026-04-02T10:00:01Z",
      toolCalls: [{ name: "read", input: "foo.ts", output: "contents" }],
    };
    expect(validateMessage(msg)).toBe(true);
  });

  it("rejects a message with missing content", () => {
    const msg: unknown = { role: "user", timestamp: "2026-04-02T10:00:00Z" };
    expect(validateMessage(msg)).toBe(false);
  });

  it("rejects a message with invalid role", () => {
    const msg: unknown = { role: "system", content: "hello", timestamp: "2026-04-02T10:00:00Z" };
    expect(validateMessage(msg)).toBe(false);
  });
});

describe("validateSession", () => {
  it("accepts a valid session", () => {
    const session = {
      id: "ses_abc123",
      tool: "claude-code" as const,
      projectPath: "/Users/test/project",
      startedAt: "2026-04-02T10:00:00Z",
      updatedAt: "2026-04-02T10:05:00Z",
      messages: [
        { role: "user" as const, content: "fix the bug", timestamp: "2026-04-02T10:00:00Z" },
        { role: "assistant" as const, content: "I'll look into it", timestamp: "2026-04-02T10:00:01Z" },
      ],
    };
    expect(validateSession(session)).toBe(true);
  });

  it("rejects a session with no messages", () => {
    const session = {
      id: "ses_abc123",
      tool: "claude-code" as const,
      projectPath: "/Users/test/project",
      startedAt: "2026-04-02T10:00:00Z",
      updatedAt: "2026-04-02T10:05:00Z",
      messages: [],
    };
    expect(validateSession(session)).toBe(false);
  });

  it("rejects a session with unknown tool", () => {
    const session = {
      id: "ses_abc123",
      tool: "unknown-tool",
      projectPath: "/Users/test/project",
      startedAt: "2026-04-02T10:00:00Z",
      updatedAt: "2026-04-02T10:05:00Z",
      messages: [{ role: "user" as const, content: "hi", timestamp: "2026-04-02T10:00:00Z" }],
    };
    expect(validateSession(session as unknown)).toBe(false);
  });
});
