import { describe, expect, it } from "vitest";
import { buildCompactionPrompt, buildAggregationPrompt, truncateMessages } from "../../src/lib/llm/prompts";

describe("buildCompactionPrompt", () => {
  it("includes all messages in the transcript", () => {
    const messages = [
      { role: "user", content: "Fix the auth bug" },
      { role: "assistant", content: "I found the issue in auth.ts line 42" },
    ];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).toContain("[user] Fix the auth bug");
    expect(prompt).toContain("[assistant] I found the issue in auth.ts line 42");
    expect(prompt).toContain("Summarize this AI coding session");
  });

  it("includes conversation title when provided", () => {
    const prompt = buildCompactionPrompt(
      [{ role: "user", content: "hello" }],
      "Fix login redirect",
    );
    expect(prompt).toContain("Fix login redirect");
  });
});

describe("truncateMessages", () => {
  it("returns all messages when under limit", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      content: `Message ${i}`,
    }));
    const result = truncateMessages(messages, 100);
    expect(result).toHaveLength(10);
  });

  it("keeps first 10 and last 50 when over limit", () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: "user",
      content: `Message ${i}`,
    }));
    const result = truncateMessages(messages, 60);
    expect(result).toHaveLength(60);
    expect(result[0].content).toBe("Message 0");
    expect(result[9].content).toBe("Message 9");
    expect(result[10].content).toBe("Message 150");
    expect(result[59].content).toBe("Message 199");
  });
});

describe("buildAggregationPrompt", () => {
  it("includes recent summaries and existing context", () => {
    const summaries = ["Summary A", "Summary B"];
    const existing = "Old project context";
    const prompt = buildAggregationPrompt(summaries, existing);
    expect(prompt).toContain("Summary A");
    expect(prompt).toContain("Summary B");
    expect(prompt).toContain("Old project context");
    expect(prompt).toContain("Merge them into a single updated project context");
  });

  it("works without existing context", () => {
    const prompt = buildAggregationPrompt(["Summary A"], null);
    expect(prompt).toContain("Summary A");
    expect(prompt).not.toContain("Existing project context");
  });
});
