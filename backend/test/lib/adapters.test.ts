import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "../../src/lib/adapters/anthropic";
import { openaiAdapter } from "../../src/lib/adapters/openai";
import { rawAdapter } from "../../src/lib/adapters/raw";
import { getAdapter, detectAdapter } from "../../src/lib/adapters";
import type { CanonicalMessage } from "../../src/lib/adapters/types";

// ============================================================
// Helpers
// ============================================================

function makeCanonical(overrides: Partial<CanonicalMessage> = {}): CanonicalMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Hello",
    source: { agent: "test" },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============================================================
// 1. Format Detection
// ============================================================

describe("Format detection", () => {
  describe("detectAdapter", () => {
    it("detects Anthropic content block format", () => {
      const raw = [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ];
      expect(detectAdapter(raw)).toBe("anthropic");
    });

    it("detects OpenAI string content format", () => {
      const raw = [
        {
          role: "user",
          content: "Hello",
        },
      ];
      expect(detectAdapter(raw)).toBe("openai");
    });

    it("detects OpenAI null content format", () => {
      const raw = [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search", arguments: '{"q":"test"}' },
            },
          ],
        },
      ];
      expect(detectAdapter(raw)).toBe("openai");
    });

    it("falls back to raw for unrecognized format", () => {
      expect(detectAdapter({})).toBe("raw");
      expect(detectAdapter(null)).toBe("raw");
      expect(detectAdapter("string")).toBe("raw");
      expect(detectAdapter([])).toBe("raw");
    });

    it("falls back to raw for empty array", () => {
      expect(detectAdapter([])).toBe("raw");
    });

    it("falls back to raw for array of non-objects", () => {
      expect(detectAdapter(["hello", 42, true])).toBe("raw");
    });
  });

  describe("individual adapter detect()", () => {
    it("anthropic detects content block arrays", () => {
      expect(
        anthropicAdapter.detect([
          { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        ])
      ).toBe(true);
    });

    it("anthropic rejects string content", () => {
      expect(
        anthropicAdapter.detect([{ role: "user", content: "Hello" }])
      ).toBe(false);
    });

    it("anthropic rejects non-array input", () => {
      expect(anthropicAdapter.detect({ role: "user", content: "Hi" })).toBe(false);
    });

    it("openai detects string content", () => {
      expect(
        openaiAdapter.detect([{ role: "user", content: "Hello" }])
      ).toBe(true);
    });

    it("openai detects null content", () => {
      expect(
        openaiAdapter.detect([{ role: "assistant", content: null }])
      ).toBe(true);
    });

    it("openai rejects content block arrays", () => {
      expect(
        openaiAdapter.detect([
          { role: "user", content: [{ type: "text", text: "Hi" }] },
        ])
      ).toBe(false);
    });

    it("raw adapter never auto-detects", () => {
      expect(rawAdapter.detect([])).toBe(false);
      expect(rawAdapter.detect([{ role: "user", content: "Hi" }])).toBe(false);
      expect(rawAdapter.detect("anything")).toBe(false);
    });
  });
});

// ============================================================
// 2. Anthropic Adapter
// ============================================================

describe("Anthropic adapter", () => {
  describe("toCanonical", () => {
    it("converts text content blocks to canonical", () => {
      const raw = [
        {
          role: "user",
          content: [{ type: "text", text: "Hello world" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there" }],
        },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("Hello world");
      expect(result[0].source.agent).toBe("anthropic");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("Hi there");
    });

    it("handles multiple text blocks in one message", () => {
      const raw = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "First paragraph" },
            { type: "text", text: "Second paragraph" },
          ],
        },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("First paragraph\nSecond paragraph");
    });

    it("handles tool_use blocks", () => {
      const raw = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me search" },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "web_search",
              input: { query: "test" },
            },
          ],
        },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      // Should produce text message + tool interaction message
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("Let me search");
      expect(result[0].role).toBe("assistant");
      expect(result[1].role).toBe("assistant");
      expect(result[1].toolInteraction).toBeDefined();
      expect(result[1].toolInteraction!.name).toBe("web_search");
      expect(result[1].toolInteraction!.input).toEqual({ query: "test" });
    });

    it("handles tool_result blocks", () => {
      const raw = [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "Search returned 5 results",
            },
          ],
        },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("tool");
      expect(result[0].content).toBe("Search returned 5 results");
      expect(result[0].toolInteraction).toBeDefined();
      expect(result[0].toolInteraction!.output).toBe("Search returned 5 results");
    });

    it("handles tool_result with content block array", () => {
      const raw = [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_456",
              content: [{ type: "text", text: "Block result" }],
            },
          ],
        },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Block result");
    });

    it("handles string content fallback (user messages)", () => {
      const raw = [
        {
          role: "user",
          content: "Simple string message",
        },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("Simple string message");
    });

    it("returns empty array for non-array input", () => {
      expect(anthropicAdapter.toCanonical(null)).toEqual([]);
      expect(anthropicAdapter.toCanonical("string")).toEqual([]);
      expect(anthropicAdapter.toCanonical({})).toEqual([]);
    });

    it("skips invalid entries in the array", () => {
      const raw = [
        null,
        42,
        { role: "user", content: [{ type: "text", text: "Valid" }] },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Valid");
    });

    it("generates unique IDs for each message", () => {
      const raw = [
        { role: "user", content: [{ type: "text", text: "A" }] },
        { role: "assistant", content: [{ type: "text", text: "B" }] },
      ];

      const result = anthropicAdapter.toCanonical(raw);
      expect(result[0].id).not.toBe(result[1].id);
    });
  });

  describe("fromCanonical", () => {
    it("converts plain text canonical messages", () => {
      const messages = [
        makeCanonical({ role: "user", content: "Hello" }),
        makeCanonical({ id: "msg-2", role: "assistant", content: "Hi" }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content[0].text).toBe("Hello");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content[0].text).toBe("Hi");
    });

    it("full fidelity preserves tool_use blocks", () => {
      const messages = [
        makeCanonical({
          role: "assistant",
          content: "Let me check",
          toolInteraction: {
            name: "search",
            input: { q: "test" },
            summary: "Called search",
          },
        }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(2);
      expect(result[0].content[0]).toEqual({ type: "text", text: "Let me check" });
      expect(result[0].content[1]).toMatchObject({
        type: "tool_use",
        name: "search",
        input: { q: "test" },
      });
    });

    it("summary fidelity collapses tool interactions to text", () => {
      const messages = [
        makeCanonical({
          role: "assistant",
          content: "Let me check",
          toolInteraction: {
            name: "search",
            input: { q: "test" },
            summary: "Called search",
          },
        }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "summary") as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(1);
      expect(result[0].content[0].text).toContain("Let me check");
      expect(result[0].content[0].text).toContain("[Tool: Called search]");
    });

    it("full fidelity preserves tool_result messages", () => {
      const messages = [
        makeCanonical({
          role: "tool",
          content: "Result data",
          toolInteraction: {
            name: "toolu_123",
            output: "Result data",
            summary: "Result for tool",
          },
        }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].content[0]).toMatchObject({
        type: "tool_result",
        tool_use_id: "toolu_123",
      });
    });

    it("summary fidelity collapses tool_result to text", () => {
      const messages = [
        makeCanonical({
          role: "tool",
          content: "Result data",
          toolInteraction: {
            name: "toolu_123",
            output: "Result data",
            summary: "Result for search",
          },
        }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "summary") as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].content[0].text).toContain("[Tool Result: Result for search]");
    });

    it("skips system messages (Anthropic uses separate system param)", () => {
      const messages = [
        makeCanonical({ role: "system", content: "You are helpful" }),
        makeCanonical({ role: "user", content: "Hello" }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
    });

    it("handles tool interaction without content", () => {
      const messages = [
        makeCanonical({
          role: "assistant",
          content: "",
          toolInteraction: {
            name: "read_file",
            input: { path: "/tmp/test" },
            summary: "Called read_file",
          },
        }),
      ];

      const result = anthropicAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      // No text block for empty content, only tool_use
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(1);
      expect(result[0].content[0]).toMatchObject({ type: "tool_use", name: "read_file" });
    });
  });
});

// ============================================================
// 3. OpenAI Adapter
// ============================================================

describe("OpenAI adapter", () => {
  describe("toCanonical", () => {
    it("converts string content messages", () => {
      const raw = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const result = openaiAdapter.toCanonical(raw);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("Hello");
      expect(result[0].source.agent).toBe("openai");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("Hi there");
    });

    it("handles system messages", () => {
      const raw = [{ role: "system", content: "You are a helper" }];

      const result = openaiAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("system");
      expect(result[0].content).toBe("You are a helper");
    });

    it("handles null content", () => {
      const raw = [{ role: "assistant", content: null }];

      const result = openaiAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("");
    });

    it("handles tool_calls on assistant messages", () => {
      const raw = [
        {
          role: "assistant",
          content: "Let me search for that",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "web_search",
                arguments: '{"query":"vitest"}',
              },
            },
          ],
        },
      ];

      const result = openaiAdapter.toCanonical(raw);
      // Text message + tool call message
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("Let me search for that");
      expect(result[1].toolInteraction).toBeDefined();
      expect(result[1].toolInteraction!.name).toBe("web_search");
      expect(result[1].toolInteraction!.input).toEqual({ query: "vitest" });
    });

    it("handles tool_calls with null content", () => {
      const raw = [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_xyz",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"SF"}' },
            },
          ],
        },
      ];

      const result = openaiAdapter.toCanonical(raw);
      // Only tool call message, no text message (content was null)
      expect(result).toHaveLength(1);
      expect(result[0].toolInteraction!.name).toBe("get_weather");
    });

    it("handles multiple tool_calls in one message", () => {
      const raw = [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search", arguments: '{"q":"a"}' },
            },
            {
              id: "call_2",
              type: "function",
              function: { name: "read", arguments: '{"path":"/tmp"}' },
            },
          ],
        },
      ];

      const result = openaiAdapter.toCanonical(raw);
      expect(result).toHaveLength(2);
      expect(result[0].toolInteraction!.name).toBe("search");
      expect(result[1].toolInteraction!.name).toBe("read");
    });

    it("handles tool role messages (tool results)", () => {
      const raw = [
        {
          role: "tool",
          content: "Search returned 3 results",
          tool_call_id: "call_abc",
          name: "web_search",
        },
      ];

      const result = openaiAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("tool");
      expect(result[0].content).toBe("Search returned 3 results");
      expect(result[0].toolInteraction!.name).toBe("call_abc");
      expect(result[0].toolInteraction!.output).toBe("Search returned 3 results");
    });

    it("handles invalid JSON in tool arguments gracefully", () => {
      const raw = [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_bad",
              type: "function",
              function: { name: "broken", arguments: "not valid json {" },
            },
          ],
        },
      ];

      const result = openaiAdapter.toCanonical(raw);
      expect(result).toHaveLength(1);
      expect(result[0].toolInteraction!.input).toEqual({ raw: "not valid json {" });
    });

    it("returns empty array for non-array input", () => {
      expect(openaiAdapter.toCanonical(null)).toEqual([]);
      expect(openaiAdapter.toCanonical("string")).toEqual([]);
      expect(openaiAdapter.toCanonical(42)).toEqual([]);
    });
  });

  describe("fromCanonical", () => {
    it("converts plain text canonical messages", () => {
      const messages = [
        makeCanonical({ role: "user", content: "Hello" }),
        makeCanonical({ id: "msg-2", role: "assistant", content: "Hi" }),
      ];

      const result = openaiAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: string | null;
      }>;

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: "user", content: "Hello" });
      expect(result[1]).toEqual({ role: "assistant", content: "Hi" });
    });

    it("preserves system messages", () => {
      const messages = [makeCanonical({ role: "system", content: "Be helpful" })];

      const result = openaiAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: string;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("system");
      expect(result[0].content).toBe("Be helpful");
    });

    it("full fidelity preserves tool_calls", () => {
      const messages = [
        makeCanonical({
          role: "assistant",
          content: "Searching...",
          toolInteraction: {
            name: "search",
            input: { q: "test" },
            summary: "Called search",
          },
        }),
      ];

      const result = openaiAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: string | null;
        tool_calls?: Array<Record<string, unknown>>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Searching...");
      expect(result[0].tool_calls).toHaveLength(1);
      expect(result[0].tool_calls![0]).toMatchObject({
        type: "function",
        function: {
          name: "search",
          arguments: '{"q":"test"}',
        },
      });
    });

    it("summary fidelity appends tool summary to content", () => {
      const messages = [
        makeCanonical({
          role: "assistant",
          content: "Searching...",
          toolInteraction: {
            name: "search",
            input: { q: "test" },
            summary: "Called search",
          },
        }),
      ];

      const result = openaiAdapter.fromCanonical(messages, "summary") as Array<{
        role: string;
        content: string;
        tool_calls?: unknown;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("Searching...");
      expect(result[0].content).toContain("[Tool: Called search]");
      expect(result[0].tool_calls).toBeUndefined();
    });

    it("full fidelity preserves tool result messages", () => {
      const messages = [
        makeCanonical({
          role: "tool",
          content: "Result data",
          toolInteraction: {
            name: "call_123",
            output: "Result data",
            summary: "Tool result",
          },
        }),
      ];

      const result = openaiAdapter.fromCanonical(messages, "full") as Array<{
        role: string;
        content: string;
        tool_call_id?: string;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("tool");
      expect(result[0].content).toBe("Result data");
      expect(result[0].tool_call_id).toBe("call_123");
    });

    it("summary fidelity collapses tool results to user messages", () => {
      const messages = [
        makeCanonical({
          role: "tool",
          content: "Result data",
          toolInteraction: {
            name: "call_123",
            output: "Result data",
            summary: "Search found 5 results",
          },
        }),
      ];

      const result = openaiAdapter.fromCanonical(messages, "summary") as Array<{
        role: string;
        content: string;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toContain("[Tool Result: Search found 5 results]");
    });
  });
});

// ============================================================
// 4. Raw Adapter
// ============================================================

describe("Raw adapter", () => {
  it("passes through canonical messages in toCanonical", () => {
    const canonical = [
      makeCanonical({ role: "user", content: "Hi" }),
      makeCanonical({ id: "msg-2", role: "assistant", content: "Hello" }),
    ];

    const result = rawAdapter.toCanonical(canonical);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Hi");
    expect(result[1].content).toBe("Hello");
  });

  it("filters out invalid entries in toCanonical", () => {
    const mixed = [
      makeCanonical({ role: "user", content: "Valid" }),
      { notAMessage: true },
      null,
      42,
    ];

    const result = rawAdapter.toCanonical(mixed);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Valid");
  });

  it("returns empty array for non-array input", () => {
    expect(rawAdapter.toCanonical("string")).toEqual([]);
    expect(rawAdapter.toCanonical(null)).toEqual([]);
    expect(rawAdapter.toCanonical({})).toEqual([]);
  });

  it("passes through in fromCanonical regardless of fidelity", () => {
    const messages = [
      makeCanonical({ role: "user", content: "Hello" }),
      makeCanonical({
        id: "msg-2",
        role: "assistant",
        content: "Hi",
        toolInteraction: { name: "test", summary: "Test tool" },
      }),
    ];

    const full = rawAdapter.fromCanonical(messages, "full");
    const summary = rawAdapter.fromCanonical(messages, "summary");

    expect(full).toEqual(messages);
    expect(summary).toEqual(messages);
  });
});

// ============================================================
// 5. Registry (getAdapter / detectAdapter)
// ============================================================

describe("Adapter registry", () => {
  it("getAdapter returns known adapters by name", () => {
    expect(getAdapter("anthropic").name).toBe("anthropic");
    expect(getAdapter("openai").name).toBe("openai");
    expect(getAdapter("raw").name).toBe("raw");
  });

  it("getAdapter falls back to raw for unknown names", () => {
    expect(getAdapter("gemini").name).toBe("raw");
    expect(getAdapter("").name).toBe("raw");
    expect(getAdapter("unknown-agent").name).toBe("raw");
  });

  it("detectAdapter prioritizes anthropic over openai for ambiguous input", () => {
    // Anthropic format — should detect anthropic first
    const anthropicMsgs = [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ];
    expect(detectAdapter(anthropicMsgs)).toBe("anthropic");
  });
});

// ============================================================
// 6. Roundtrip Tests
// ============================================================

describe("Roundtrip: canonical -> export -> re-import", () => {
  it("Anthropic roundtrip preserves core data (full fidelity)", () => {
    const original = [
      makeCanonical({ id: "m1", role: "user", content: "Hello" }),
      makeCanonical({ id: "m2", role: "assistant", content: "World" }),
    ];

    const exported = anthropicAdapter.fromCanonical(original, "full");
    const reimported = anthropicAdapter.toCanonical(exported);

    expect(reimported).toHaveLength(2);
    expect(reimported[0].role).toBe("user");
    expect(reimported[0].content).toBe("Hello");
    expect(reimported[1].role).toBe("assistant");
    expect(reimported[1].content).toBe("World");
  });

  it("OpenAI roundtrip preserves core data (full fidelity)", () => {
    const original = [
      makeCanonical({ id: "m1", role: "user", content: "Hello" }),
      makeCanonical({ id: "m2", role: "assistant", content: "World" }),
    ];

    const exported = openaiAdapter.fromCanonical(original, "full");
    const reimported = openaiAdapter.toCanonical(exported);

    expect(reimported).toHaveLength(2);
    expect(reimported[0].role).toBe("user");
    expect(reimported[0].content).toBe("Hello");
    expect(reimported[1].role).toBe("assistant");
    expect(reimported[1].content).toBe("World");
  });

  it("OpenAI roundtrip preserves system messages", () => {
    const original = [
      makeCanonical({ id: "s1", role: "system", content: "You are helpful" }),
      makeCanonical({ id: "m1", role: "user", content: "Hi" }),
    ];

    const exported = openaiAdapter.fromCanonical(original, "full");
    const reimported = openaiAdapter.toCanonical(exported);

    expect(reimported).toHaveLength(2);
    expect(reimported[0].role).toBe("system");
    expect(reimported[0].content).toBe("You are helpful");
  });

  it("Cross-agent roundtrip: Anthropic -> canonical -> OpenAI preserves content", () => {
    const anthropicRaw = [
      { role: "user", content: [{ type: "text", text: "What's the weather?" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "It's sunny and 72F." }],
      },
    ];

    const canonical = anthropicAdapter.toCanonical(anthropicRaw);
    const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: string;
    }>;

    expect(openaiExport).toHaveLength(2);
    expect(openaiExport[0].role).toBe("user");
    expect(openaiExport[0].content).toBe("What's the weather?");
    expect(openaiExport[1].role).toBe("assistant");
    expect(openaiExport[1].content).toBe("It's sunny and 72F.");
  });

  it("Cross-agent roundtrip: OpenAI -> canonical -> Anthropic preserves content", () => {
    const openaiRaw = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const canonical = openaiAdapter.toCanonical(openaiRaw);
    const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: Array<{ type: string; text: string }>;
    }>;

    expect(anthropicExport).toHaveLength(2);
    expect(anthropicExport[0].role).toBe("user");
    expect(anthropicExport[0].content[0].text).toBe("Hello");
    expect(anthropicExport[1].role).toBe("assistant");
    expect(anthropicExport[1].content[0].text).toBe("Hi there");
  });
});

// ============================================================
// 7. Fidelity Mode Tests
// ============================================================

describe("Fidelity modes", () => {
  const toolMessage = makeCanonical({
    id: "tool-msg",
    role: "assistant",
    content: "I'll help with that.",
    toolInteraction: {
      name: "file_read",
      input: { path: "/src/index.ts" },
      summary: "Read /src/index.ts (245 lines)",
    },
  });

  describe("summary mode collapses tools across all adapters", () => {
    it("Anthropic summary: tool becomes text annotation", () => {
      const result = anthropicAdapter.fromCanonical([toolMessage], "summary") as Array<{
        content: Array<{ type: string; text: string }>;
      }>;

      expect(result).toHaveLength(1);
      const text = result[0].content[0].text;
      expect(text).toContain("[Tool: Read /src/index.ts (245 lines)]");
      expect(text).toContain("I'll help with that.");
      // Should NOT contain tool_use blocks
      expect(result[0].content.every((b) => b.type === "text")).toBe(true);
    });

    it("OpenAI summary: tool becomes text in content", () => {
      const result = openaiAdapter.fromCanonical([toolMessage], "summary") as Array<{
        content: string;
        tool_calls?: unknown;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("[Tool: Read /src/index.ts (245 lines)]");
      expect(result[0].content).toContain("I'll help with that.");
      expect(result[0].tool_calls).toBeUndefined();
    });
  });

  describe("full mode preserves tools across all adapters", () => {
    it("Anthropic full: tool becomes tool_use block", () => {
      const result = anthropicAdapter.fromCanonical([toolMessage], "full") as Array<{
        content: Array<Record<string, unknown>>;
      }>;

      expect(result).toHaveLength(1);
      const toolBlock = result[0].content.find((b) => b.type === "tool_use");
      expect(toolBlock).toBeDefined();
      expect(toolBlock!.name).toBe("file_read");
      expect(toolBlock!.input).toEqual({ path: "/src/index.ts" });
    });

    it("OpenAI full: tool becomes tool_calls array", () => {
      const result = openaiAdapter.fromCanonical([toolMessage], "full") as Array<{
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].tool_calls).toHaveLength(1);
      expect(result[0].tool_calls![0].function.name).toBe("file_read");
    });
  });
});

// ============================================================
// 8. Edge Cases
// ============================================================

describe("Edge cases", () => {
  it("handles empty message arrays", () => {
    expect(anthropicAdapter.toCanonical([])).toEqual([]);
    expect(openaiAdapter.toCanonical([])).toEqual([]);
    expect(rawAdapter.toCanonical([])).toEqual([]);

    expect(anthropicAdapter.fromCanonical([], "full")).toEqual([]);
    expect(openaiAdapter.fromCanonical([], "full")).toEqual([]);
    expect(rawAdapter.fromCanonical([], "full")).toEqual([]);
  });

  it("handles messages with missing fields gracefully", () => {
    // Missing role
    const noRole = [{ content: "Hello" }];
    expect(anthropicAdapter.toCanonical(noRole)).toEqual([]);

    // Missing content
    const noContent = [{ role: "user" }];
    const result = openaiAdapter.toCanonical(noContent);
    // OpenAI treats undefined content similarly to null — our detect wouldn't match
    // but toCanonical should handle gracefully
    expect(result).toBeDefined();
  });

  it("Anthropic: mixed content blocks (text + tool_use)", () => {
    const raw = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Before tool" },
          { type: "tool_use", id: "t1", name: "calc", input: { x: 1 } },
          // Note: in practice, text after tool_use is rare but should not crash
        ],
      },
    ];

    const result = anthropicAdapter.toCanonical(raw);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].content).toBe("Before tool");
    expect(result[1].toolInteraction?.name).toBe("calc");
  });

  it("OpenAI: tool result without tool_call_id", () => {
    const raw = [{ role: "tool", content: "Some result" }];
    const result = openaiAdapter.toCanonical(raw);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].toolInteraction?.name).toBe("unknown");
  });

  it("handles very long content strings", () => {
    const longContent = "x".repeat(100_000);
    const raw = [{ role: "user", content: longContent }];

    const result = openaiAdapter.toCanonical(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content.length).toBe(100_000);
  });

  it("handles empty string content", () => {
    const raw = [{ role: "user", content: "" }];
    const result = openaiAdapter.toCanonical(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("");
  });

  it("Anthropic: empty content block array", () => {
    const raw = [{ role: "assistant", content: [] }];
    // Empty array doesn't pass isContentBlockArray check
    const result = anthropicAdapter.toCanonical(raw);
    expect(result).toEqual([]);
  });

  it("raw adapter preserves toolInteraction on passthrough", () => {
    const messages = [
      makeCanonical({
        toolInteraction: { name: "test", input: { a: 1 }, summary: "Test" },
      }),
    ];
    const result = rawAdapter.fromCanonical(messages, "full") as CanonicalMessage[];
    expect(result[0].toolInteraction?.name).toBe("test");
  });
});
