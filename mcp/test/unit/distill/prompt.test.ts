import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../../src/distill/prompt.js";
import type { CapturedSession } from "../../../src/capture/types.js";

function makeSession(messageCount: number): CapturedSession {
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i + 1} content here`,
      timestamp: `2026-04-02T10:${String(i).padStart(2, "0")}:00Z`,
    });
  }
  return {
    id: "ses_test1234567890",
    tool: "claude-code",
    projectPath: "/tmp/project",
    startedAt: "2026-04-02T10:00:00Z",
    updatedAt: "2026-04-02T10:30:00Z",
    messages,
  };
}

describe("buildPrompt", () => {
  it("includes the session transcript in the prompt", () => {
    const session = makeSession(4);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("Message 1 content here");
    expect(prompt).toContain("Message 4 content here");
  });

  it("includes role labels for each message", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("[user]");
    expect(prompt).toContain("[assistant]");
  });

  it("instructs extraction of decisions, architecture, and learnings", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("decision");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("learning");
  });

  it("requests JSON output format", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("JSON");
  });

  it("includes existing workspace files when provided", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session, ["decisions/chose-redis.md", "architecture/auth.md"]);
    expect(prompt).toContain("chose-redis.md");
    expect(prompt).toContain("auth.md");
  });

  it("includes session metadata", () => {
    const session = makeSession(2);
    const prompt = buildPrompt(session);
    expect(prompt).toContain("claude-code");
    expect(prompt).toContain("/tmp/project");
  });
});
