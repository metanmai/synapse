import { describe, expect, it } from "vitest";
import { detectAdapter, getAdapter } from "../../src/lib/adapters";
import { anthropicAdapter } from "../../src/lib/adapters/anthropic";
import { openaiAdapter } from "../../src/lib/adapters/openai";
import { rawAdapter } from "../../src/lib/adapters/raw";
import type { CanonicalMessage } from "../../src/lib/adapters/types";

// ============================================================
// Helpers
// ============================================================

let idCounter = 0;
function makeCanonical(overrides: Partial<CanonicalMessage> = {}): CanonicalMessage {
  idCounter++;
  return {
    id: `msg-${idCounter}`,
    role: "assistant",
    content: "Hello",
    source: { agent: "test" },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ============================================================
// 1. Anthropic -> Canonical -> OpenAI roundtrip
// ============================================================

describe("Cross-agent conversation sync", () => {
  describe("Anthropic -> Canonical -> OpenAI roundtrip", () => {
    it("preserves text content through Anthropic -> OpenAI conversion", () => {
      const anthropicRaw = [
        { role: "user", content: [{ type: "text", text: "Fix the auth bug in middleware" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "I'll examine the auth middleware code." }],
        },
      ];

      const canonical = anthropicAdapter.toCanonical(anthropicRaw);
      const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: string | null;
      }>;

      expect(openaiExport).toHaveLength(2);
      expect(openaiExport[0].role).toBe("user");
      expect(openaiExport[0].content).toBe("Fix the auth bug in middleware");
      expect(openaiExport[1].role).toBe("assistant");
      expect(openaiExport[1].content).toBe("I'll examine the auth middleware code.");
    });

    it("preserves tool_use through Anthropic -> OpenAI conversion", () => {
      const anthropicRaw = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me search the codebase." },
            {
              type: "tool_use",
              id: "toolu_search_1",
              name: "Grep",
              input: { pattern: "validateToken", path: "/src" },
            },
          ],
        },
      ];

      const canonical = anthropicAdapter.toCanonical(anthropicRaw);
      expect(canonical).toHaveLength(2);
      expect(canonical[0].content).toBe("Let me search the codebase.");
      expect(canonical[1].toolInteraction?.name).toBe("Grep");

      const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: string | null;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      }>;

      // Text message + tool call message
      expect(openaiExport).toHaveLength(2);
      expect(openaiExport[0].content).toBe("Let me search the codebase.");
      expect(openaiExport[1].tool_calls).toBeDefined();
      expect(openaiExport[1].tool_calls?.[0].function.name).toBe("Grep");
      const parsedArgs = JSON.parse(openaiExport[1].tool_calls?.[0].function.arguments ?? "{}");
      expect(parsedArgs).toEqual({ pattern: "validateToken", path: "/src" });
    });

    it("preserves tool_result through Anthropic -> OpenAI conversion", () => {
      const anthropicRaw = [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_search_1",
              content: "Found 3 matches in auth.ts",
            },
          ],
        },
      ];

      const canonical = anthropicAdapter.toCanonical(anthropicRaw);
      expect(canonical).toHaveLength(1);
      expect(canonical[0].role).toBe("tool");

      const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: string;
        tool_call_id?: string;
      }>;

      expect(openaiExport).toHaveLength(1);
      expect(openaiExport[0].role).toBe("tool");
      expect(openaiExport[0].content).toBe("Found 3 matches in auth.ts");
    });

    it("handles a full multi-turn conversation with tools", () => {
      const anthropicRaw = [
        { role: "user", content: [{ type: "text", text: "Read the config file" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Reading the configuration." },
            { type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/config.json" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"port": 3000}' }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "The config has port 3000." }],
        },
      ];

      const canonical = anthropicAdapter.toCanonical(anthropicRaw);
      // user text, assistant text, assistant tool_use, tool result, assistant text
      expect(canonical.length).toBeGreaterThanOrEqual(4);

      const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: string | null;
      }>;

      // All messages should be present
      expect(openaiExport.length).toBeGreaterThanOrEqual(4);

      // First and last messages preserve their text
      expect(openaiExport[0].content).toBe("Read the config file");
      const lastMsg = openaiExport[openaiExport.length - 1];
      expect(lastMsg.content).toBe("The config has port 3000.");
    });
  });

  // ============================================================
  // 2. OpenAI -> Canonical -> Anthropic roundtrip
  // ============================================================

  describe("OpenAI -> Canonical -> Anthropic roundtrip", () => {
    it("preserves text content through OpenAI -> Anthropic conversion", () => {
      const openaiRaw = [
        { role: "system", content: "You are a helpful coding assistant." },
        { role: "user", content: "Explain the adapter pattern." },
        { role: "assistant", content: "The adapter pattern converts one interface to another." },
      ];

      const canonical = openaiAdapter.toCanonical(openaiRaw);
      const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;

      // Anthropic skips system messages (separate param)
      expect(anthropicExport).toHaveLength(2);
      expect(anthropicExport[0].role).toBe("user");
      expect(anthropicExport[0].content[0].text).toBe("Explain the adapter pattern.");
      expect(anthropicExport[1].role).toBe("assistant");
      expect(anthropicExport[1].content[0].text).toBe("The adapter pattern converts one interface to another.");
    });

    it("preserves tool_calls through OpenAI -> Anthropic conversion", () => {
      const openaiRaw = [
        {
          role: "assistant",
          content: "Let me search for that.",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "web_search",
                arguments: '{"query":"adapter pattern in TypeScript"}',
              },
            },
          ],
        },
      ];

      const canonical = openaiAdapter.toCanonical(openaiRaw);
      expect(canonical).toHaveLength(2); // text + tool call

      const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      expect(anthropicExport).toHaveLength(2);
      // First: text message
      expect(anthropicExport[0].content[0]).toMatchObject({ type: "text", text: "Let me search for that." });
      // Second: tool_use block
      const toolBlock = anthropicExport[1].content.find((b) => b.type === "tool_use");
      expect(toolBlock).toBeDefined();
      expect(toolBlock?.name).toBe("web_search");
    });

    it("preserves tool result through OpenAI -> Anthropic conversion", () => {
      const openaiRaw = [
        {
          role: "tool",
          content: "Found 10 results for adapter pattern",
          tool_call_id: "call_abc",
          name: "web_search",
        },
      ];

      const canonical = openaiAdapter.toCanonical(openaiRaw);
      expect(canonical).toHaveLength(1);
      expect(canonical[0].role).toBe("tool");

      const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      expect(anthropicExport).toHaveLength(1);
      expect(anthropicExport[0].role).toBe("user"); // Anthropic tool results come as user role
      expect(anthropicExport[0].content[0]).toMatchObject({ type: "tool_result" });
    });

    it("handles multi-turn OpenAI conversation with tool calls and results", () => {
      const openaiRaw = [
        { role: "user", content: "What's the weather in SF?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_weather",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"San Francisco"}' },
            },
          ],
        },
        {
          role: "tool",
          content: "72F, sunny",
          tool_call_id: "call_weather",
          name: "get_weather",
        },
        { role: "assistant", content: "It's 72F and sunny in San Francisco." },
      ];

      const canonical = openaiAdapter.toCanonical(openaiRaw);
      const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
        role: string;
        content: string | Array<Record<string, unknown>>;
      }>;

      // All turns should be present
      expect(anthropicExport.length).toBeGreaterThanOrEqual(3);

      // Final answer preserved
      const lastMsg = anthropicExport[anthropicExport.length - 1];
      const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content[0] : lastMsg.content;
      const text = typeof lastContent === "string" ? lastContent : (lastContent as Record<string, unknown>).text;
      expect(text).toBe("It's 72F and sunny in San Francisco.");
    });
  });

  // ============================================================
  // 3. Fidelity modes
  // ============================================================

  describe("Fidelity modes", () => {
    const canonicalWithTool: CanonicalMessage[] = [
      makeCanonical({
        role: "user",
        content: "Find the bug",
      }),
      makeCanonical({
        role: "assistant",
        content: "Searching for the issue.",
        toolInteraction: {
          name: "Grep",
          input: { pattern: "throw.*Error", path: "/src" },
          output: "src/auth.ts:42: throw new AuthError('invalid token')",
          summary: "Grep for thrown errors (1 match in auth.ts)",
        },
      }),
      makeCanonical({
        role: "tool",
        content: "src/auth.ts:42: throw new AuthError('invalid token')",
        toolInteraction: {
          name: "Grep",
          output: "src/auth.ts:42: throw new AuthError('invalid token')",
          summary: "Grep returned 1 match",
        },
      }),
      makeCanonical({
        role: "assistant",
        content: "Found the bug in auth.ts line 42.",
      }),
    ];

    describe("full fidelity preserves tool details", () => {
      it("Anthropic full export has tool_use blocks with input", () => {
        const result = anthropicAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
          role: string;
          content: Array<Record<string, unknown>>;
        }>;

        const toolUseMsg = result.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"));
        expect(toolUseMsg).toBeDefined();
        const toolBlock = toolUseMsg?.content.find((b) => b.type === "tool_use");
        expect(toolBlock?.name).toBe("Grep");
        expect(toolBlock?.input).toEqual({ pattern: "throw.*Error", path: "/src" });
      });

      it("OpenAI full export has tool_calls with arguments", () => {
        const result = openaiAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
          role: string;
          content: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        }>;

        const toolCallMsg = result.find((m) => m.tool_calls && m.tool_calls.length > 0);
        expect(toolCallMsg).toBeDefined();
        expect(toolCallMsg?.tool_calls?.[0].function.name).toBe("Grep");
        const args = JSON.parse(toolCallMsg?.tool_calls?.[0].function.arguments);
        expect(args).toEqual({ pattern: "throw.*Error", path: "/src" });
      });

      it("OpenAI full export preserves tool result as tool role", () => {
        const result = openaiAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
          role: string;
          content: string;
          tool_call_id?: string;
        }>;

        const toolResult = result.find((m) => m.role === "tool");
        expect(toolResult).toBeDefined();
        expect(toolResult?.content).toContain("auth.ts");
      });
    });

    describe("summary fidelity collapses tool details", () => {
      it("Anthropic summary has only text blocks, no tool_use", () => {
        const result = anthropicAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
          role: string;
          content: Array<{ type: string; text: string }>;
        }>;

        for (const msg of result) {
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              expect(block.type).toBe("text");
            }
          }
        }

        // Tool interaction collapsed to text annotation
        const toolAnnotation = result.find(
          (m) => Array.isArray(m.content) && m.content.some((b) => b.text.includes("[Tool:")),
        );
        expect(toolAnnotation).toBeDefined();
      });

      it("OpenAI summary has no tool_calls, tool interactions are text", () => {
        const result = openaiAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
          role: string;
          content: string;
          tool_calls?: unknown;
        }>;

        for (const msg of result) {
          expect(msg.tool_calls).toBeUndefined();
        }

        // Tool interaction becomes text annotation
        const toolAnnotation = result.find((m) => typeof m.content === "string" && m.content.includes("[Tool:"));
        expect(toolAnnotation).toBeDefined();
      });

      it("summary collapses tool_result into user-visible text", () => {
        const result = openaiAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
          role: string;
          content: string;
        }>;

        // Tool result should become a user message with [Tool Result: ...] annotation
        const toolResultAnnotation = result.find(
          (m) => typeof m.content === "string" && m.content.includes("[Tool Result:"),
        );
        expect(toolResultAnnotation).toBeDefined();
        expect(toolResultAnnotation?.role).toBe("user");
      });
    });
  });

  // ============================================================
  // 4. Format detection
  // ============================================================

  describe("Format detection", () => {
    it("detects Anthropic format from content block arrays", () => {
      const anthropicMessages = [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      ];
      expect(detectAdapter(anthropicMessages)).toBe("anthropic");
    });

    it("detects OpenAI format from string content", () => {
      const openaiMessages = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ];
      expect(detectAdapter(openaiMessages)).toBe("openai");
    });

    it("detects OpenAI format from null content with tool_calls", () => {
      const openaiToolCall = [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "test", arguments: "{}" } }],
        },
      ];
      expect(detectAdapter(openaiToolCall)).toBe("openai");
    });

    it("falls back to raw for unrecognized format", () => {
      expect(detectAdapter({})).toBe("raw");
      expect(detectAdapter(null)).toBe("raw");
      expect(detectAdapter([])).toBe("raw");
      expect(detectAdapter([{ arbitrary: "data" }])).toBe("raw");
    });

    it("getAdapter returns correct adapter by name", () => {
      expect(getAdapter("anthropic").name).toBe("anthropic");
      expect(getAdapter("openai").name).toBe("openai");
      expect(getAdapter("raw").name).toBe("raw");
    });

    it("getAdapter falls back to raw for unknown names", () => {
      expect(getAdapter("gemini").name).toBe("raw");
      expect(getAdapter("claude").name).toBe("raw");
      expect(getAdapter("").name).toBe("raw");
    });
  });

  // ============================================================
  // 5. Edge cases
  // ============================================================

  describe("Edge cases", () => {
    it("empty messages array produces empty output for all adapters", () => {
      expect(anthropicAdapter.toCanonical([])).toEqual([]);
      expect(openaiAdapter.toCanonical([])).toEqual([]);
      expect(rawAdapter.toCanonical([])).toEqual([]);

      expect(anthropicAdapter.fromCanonical([], "full")).toEqual([]);
      expect(openaiAdapter.fromCanonical([], "full")).toEqual([]);
      expect(rawAdapter.fromCanonical([], "full")).toEqual([]);
      expect(anthropicAdapter.fromCanonical([], "summary")).toEqual([]);
      expect(openaiAdapter.fromCanonical([], "summary")).toEqual([]);
    });

    it("messages with only system role", () => {
      const systemOnly = [makeCanonical({ role: "system", content: "Be helpful." })];

      // Anthropic skips system messages
      const anthropicResult = anthropicAdapter.fromCanonical(systemOnly, "full");
      expect(anthropicResult).toEqual([]);

      // OpenAI preserves system messages
      const openaiResult = openaiAdapter.fromCanonical(systemOnly, "full") as Array<{
        role: string;
        content: string;
      }>;
      expect(openaiResult).toHaveLength(1);
      expect(openaiResult[0].role).toBe("system");
      expect(openaiResult[0].content).toBe("Be helpful.");
    });

    it("messages with media attachments survive canonical roundtrip via raw adapter", () => {
      const withMedia = makeCanonical({
        role: "user",
        content: "See this image",
        media: [
          {
            id: "media-1",
            type: "image",
            mimeType: "image/png",
            filename: "screenshot.png",
            size: 1024,
            storagePath: "/uploads/screenshot.png",
          },
        ],
      });

      // Raw adapter preserves everything
      const rawResult = rawAdapter.fromCanonical([withMedia], "full") as CanonicalMessage[];
      expect(rawResult).toHaveLength(1);
      expect(rawResult[0].media).toBeDefined();
      expect(rawResult[0].media?.[0].filename).toBe("screenshot.png");
      expect(rawResult[0].media?.[0].type).toBe("image");
    });

    it("very long content strings are preserved through roundtrip", () => {
      const longContent = "x".repeat(50_000);
      const openaiRaw = [{ role: "user", content: longContent }];

      const canonical = openaiAdapter.toCanonical(openaiRaw);
      expect(canonical[0].content.length).toBe(50_000);

      const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
        content: Array<{ text: string }>;
      }>;
      expect(anthropicExport[0].content[0].text.length).toBe(50_000);
    });

    it("unicode and emoji in content are preserved through roundtrip", () => {
      const unicodeContent =
        "Hello \u{1F44B} \u4F60\u597D \u041F\u0440\u0438\u0432\u0435\u0442 \uD55C\uAD6D\uC5B4 \u2603\uFE0F\u2744\uFE0F\u2728";
      const openaiRaw = [{ role: "user", content: unicodeContent }];

      const canonical = openaiAdapter.toCanonical(openaiRaw);
      expect(canonical[0].content).toBe(unicodeContent);

      const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
        content: Array<{ text: string }>;
      }>;
      expect(anthropicExport[0].content[0].text).toBe(unicodeContent);

      // Full roundtrip back to OpenAI
      const reimported = anthropicAdapter.toCanonical(anthropicExport);
      const openaiReExport = openaiAdapter.fromCanonical(reimported, "full") as Array<{
        content: string;
      }>;
      expect(openaiReExport[0].content).toBe(unicodeContent);
    });

    it("tool interaction with no output (pending tool call)", () => {
      const pendingTool = makeCanonical({
        role: "assistant",
        content: "",
        toolInteraction: {
          name: "long_running_task",
          input: { command: "npm run build" },
          summary: "Running build (pending...)",
        },
      });

      // Full fidelity should preserve the tool call without output
      const openaiResult = openaiAdapter.fromCanonical([pendingTool], "full") as Array<{
        role: string;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      }>;

      expect(openaiResult).toHaveLength(1);
      expect(openaiResult[0].tool_calls).toBeDefined();
      expect(openaiResult[0].tool_calls?.[0].function.name).toBe("long_running_task");

      const anthropicResult = anthropicAdapter.fromCanonical([pendingTool], "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      expect(anthropicResult).toHaveLength(1);
      const toolBlock = anthropicResult[0].content.find((b) => b.type === "tool_use");
      expect(toolBlock).toBeDefined();
      expect(toolBlock?.name).toBe("long_running_task");
    });

    it("mixed agent sources in canonical messages", () => {
      // Simulating a cross-agent conversation where messages come from different agents
      const mixedMessages = [
        makeCanonical({ role: "user", content: "Start here", source: { agent: "claude-code" } }),
        makeCanonical({
          role: "assistant",
          content: "I'll help.",
          source: { agent: "claude-code", model: "claude-opus-4-6" },
        }),
        makeCanonical({ role: "user", content: "Continue here", source: { agent: "cursor" } }),
        makeCanonical({
          role: "assistant",
          content: "Picking up where we left off.",
          source: { agent: "cursor", model: "gpt-4o" },
        }),
      ];

      // Export to OpenAI format — content should all be preserved regardless of source
      const openaiExport = openaiAdapter.fromCanonical(mixedMessages, "full") as Array<{
        role: string;
        content: string;
      }>;

      expect(openaiExport).toHaveLength(4);
      expect(openaiExport[0].content).toBe("Start here");
      expect(openaiExport[1].content).toBe("I'll help.");
      expect(openaiExport[2].content).toBe("Continue here");
      expect(openaiExport[3].content).toBe("Picking up where we left off.");

      // Export to Anthropic format — same preservation
      const anthropicExport = anthropicAdapter.fromCanonical(mixedMessages, "full") as Array<{
        role: string;
        content: Array<{ text: string }>;
      }>;

      expect(anthropicExport).toHaveLength(4);
      expect(anthropicExport[0].content[0].text).toBe("Start here");
      expect(anthropicExport[3].content[0].text).toBe("Picking up where we left off.");
    });

    it("empty string content is handled correctly", () => {
      const emptyContent = makeCanonical({ role: "assistant", content: "" });

      const openaiResult = openaiAdapter.fromCanonical([emptyContent], "full") as Array<{
        content: string;
      }>;
      expect(openaiResult[0].content).toBe("");

      const anthropicResult = anthropicAdapter.fromCanonical([emptyContent], "full") as Array<{
        content: Array<{ text: string }>;
      }>;
      expect(anthropicResult[0].content[0].text).toBe("");
    });

    it("tool interaction with empty input object", () => {
      const noInput = makeCanonical({
        role: "assistant",
        content: "",
        toolInteraction: {
          name: "get_status",
          input: {},
          summary: "Checked status",
        },
      });

      const openaiResult = openaiAdapter.fromCanonical([noInput], "full") as Array<{
        tool_calls?: Array<{ function: { arguments: string } }>;
      }>;
      expect(openaiResult[0].tool_calls?.[0].function.arguments).toBe("{}");
    });
  });

  // ============================================================
  // 6. Cross-format fidelity comparison
  // ============================================================

  describe("Cross-format fidelity comparison", () => {
    const toolConversation: CanonicalMessage[] = [
      makeCanonical({ role: "user", content: "Find all TODO comments" }),
      makeCanonical({
        role: "assistant",
        content: "Searching the codebase.",
        toolInteraction: {
          name: "Grep",
          input: { pattern: "TODO", path: "/src" },
          output: "Found 7 matches across 4 files",
          summary: "Grep for TODO (7 matches, 4 files)",
        },
      }),
      makeCanonical({
        role: "tool",
        content: "Found 7 matches across 4 files",
        toolInteraction: {
          name: "Grep",
          output: "Found 7 matches across 4 files",
          summary: "Grep returned 7 matches",
        },
      }),
      makeCanonical({ role: "assistant", content: "I found 7 TODO comments across 4 files." }),
    ];

    it("full fidelity: Anthropic and OpenAI both have tool structures", () => {
      const anthropicFull = anthropicAdapter.fromCanonical(toolConversation, "full") as Array<{
        content: Array<Record<string, unknown>>;
      }>;
      const openFull = openaiAdapter.fromCanonical(toolConversation, "full") as Array<{
        tool_calls?: unknown[];
      }>;

      const hasAnthropicTool = anthropicFull.some(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"),
      );
      const hasOpenaiTool = openFull.some((m) => m.tool_calls && (m.tool_calls as unknown[]).length > 0);

      expect(hasAnthropicTool).toBe(true);
      expect(hasOpenaiTool).toBe(true);
    });

    it("summary fidelity: neither format has tool structures", () => {
      const anthropicSummary = anthropicAdapter.fromCanonical(toolConversation, "summary") as Array<{
        content: Array<{ type: string; text: string }>;
      }>;
      const openSummary = openaiAdapter.fromCanonical(toolConversation, "summary") as Array<{
        content: string;
        tool_calls?: unknown[];
      }>;

      // Anthropic: no tool_use blocks
      const hasAnthropicTool = anthropicSummary.some(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"),
      );
      expect(hasAnthropicTool).toBe(false);

      // OpenAI: no tool_calls
      const hasOpenaiTool = openSummary.some((m) => m.tool_calls && (m.tool_calls as unknown[]).length > 0);
      expect(hasOpenaiTool).toBe(false);

      // Both should have the summary text embedded
      const anthropicText = anthropicSummary.map((m) => m.content.map((b) => b.text).join(" ")).join(" ");
      const openaiText = openSummary.map((m) => m.content).join(" ");

      expect(anthropicText).toContain("[Tool:");
      expect(openaiText).toContain("[Tool:");
    });
  });
});

// ============================================================
// 7. Cross-agent resume simulation
// ============================================================

describe("Cross-agent resume simulation", () => {
  it("Agent A (Claude) messages survive roundtrip to Agent B (ChatGPT) format", () => {
    // 1. Anthropic messages from a Claude Code session
    const claudeMessages = [
      { role: "user", content: [{ type: "text", text: "Fix the auth bug in middleware" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll look at the auth middleware code." },
          {
            type: "tool_use",
            id: "toolu_read_1",
            name: "Read",
            input: { file_path: "/src/lib/auth.ts" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_read_1",
            content: "export function authMiddleware() { /* ... */ }",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Found the issue — the token validation is missing the expiry check.",
          },
        ],
      },
    ];

    // 2. Convert to canonical (what sync_conversation does on ingest)
    const canonical = anthropicAdapter.toCanonical(claudeMessages);
    expect(canonical.length).toBeGreaterThan(0);

    // 3. Verify canonical has all content
    expect(canonical.some((m) => m.content.includes("Fix the auth bug"))).toBe(true);
    expect(canonical.some((m) => m.content.includes("Found the issue"))).toBe(true);
    expect(canonical.some((m) => m.toolInteraction?.name === "Read")).toBe(true);

    // 4. Convert to OpenAI format (what load_conversation does for ChatGPT)
    const openaiMessages = openaiAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    }>;
    expect(openaiMessages).toBeDefined();
    expect(openaiMessages.length).toBeGreaterThan(0);

    // Verify user message preserved
    expect(openaiMessages.some((m) => m.content?.includes("Fix the auth bug"))).toBe(true);
    // Verify assistant conclusion preserved
    expect(openaiMessages.some((m) => m.content?.includes("Found the issue"))).toBe(true);
    // Verify tool call preserved
    const toolCallMsg = openaiMessages.find((m) => m.tool_calls && m.tool_calls.length > 0);
    expect(toolCallMsg).toBeDefined();
    expect(toolCallMsg?.tool_calls?.[0].function.name).toBe("Read");
  });

  it("Agent B (ChatGPT) messages survive roundtrip to Agent A (Claude) format", () => {
    // OpenAI-format messages from a ChatGPT session
    const chatgptMessages = [
      { role: "system", content: "You are a senior engineer." },
      { role: "user", content: "Continue fixing the auth bug — add the expiry check." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_edit_1",
            type: "function",
            function: {
              name: "edit_file",
              arguments: '{"path":"/src/lib/auth.ts","content":"if (isExpired(token)) throw new Error()"}',
            },
          },
        ],
      },
      {
        role: "tool",
        content: "File edited successfully.",
        tool_call_id: "call_edit_1",
        name: "edit_file",
      },
      {
        role: "assistant",
        content: "I've added the token expiry validation to auth.ts.",
      },
    ];

    // Convert to canonical
    const canonical = openaiAdapter.toCanonical(chatgptMessages);
    expect(canonical.length).toBeGreaterThan(0);

    // Verify canonical captured the key content
    expect(canonical.some((m) => m.role === "system")).toBe(true);
    expect(canonical.some((m) => m.content.includes("expiry check"))).toBe(true);
    expect(canonical.some((m) => m.toolInteraction?.name === "edit_file")).toBe(true);
    expect(canonical.some((m) => m.content.includes("added the token expiry"))).toBe(true);

    // Convert to Anthropic format
    const anthropicMessages = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    expect(anthropicMessages).toBeDefined();
    expect(anthropicMessages.length).toBeGreaterThan(0);

    // Anthropic skips system messages, so user content should be present
    const userMsg = anthropicMessages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => typeof b.text === "string" && (b.text as string).includes("expiry check")),
    );
    expect(userMsg).toBeDefined();

    // Tool use block should be present
    const toolUseMsg = anthropicMessages.find(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"),
    );
    expect(toolUseMsg).toBeDefined();

    // Final assistant message preserved
    const conclusionMsg = anthropicMessages.find(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((b) => typeof b.text === "string" && (b.text as string).includes("added the token expiry")),
    );
    expect(conclusionMsg).toBeDefined();
  });

  it("preserves system prompt across agents", () => {
    const messages = [
      { role: "system", content: "You are a senior engineer working on the Synapse project." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there." },
    ];

    // OpenAI → canonical → OpenAI preserves system
    const canonical = openaiAdapter.toCanonical(messages);
    const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: string;
    }>;
    expect(openaiExport[0]?.role).toBe("system");
    expect(openaiExport[0]?.content).toBe("You are a senior engineer working on the Synapse project.");

    // raw → canonical → OpenAI also preserves system
    const rawCanonical = rawAdapter.toCanonical(messages);
    const rawToOpenai = openaiAdapter.fromCanonical(rawCanonical, "full") as Array<{
      role: string;
      content: string;
    }>;
    expect(rawToOpenai[0]?.role).toBe("system");
  });

  it("mixed agent sources in canonical survive export to both formats", () => {
    // Simulating a conversation where messages come from different agents
    const mixedMessages = [
      makeCanonical({ role: "user", content: "Start the auth fix", source: { agent: "claude-code" } }),
      makeCanonical({
        role: "assistant",
        content: "Looking at auth middleware now.",
        source: { agent: "claude-code", model: "claude-opus-4-6" },
      }),
      makeCanonical({ role: "user", content: "Continue the fix", source: { agent: "cursor" } }),
      makeCanonical({
        role: "assistant",
        content: "Picking up where Claude left off.",
        source: { agent: "cursor", model: "gpt-4o" },
      }),
    ];

    // Export to OpenAI — all content preserved regardless of source agent
    const openaiExport = openaiAdapter.fromCanonical(mixedMessages, "full") as Array<{
      role: string;
      content: string;
    }>;
    expect(openaiExport).toHaveLength(4);
    expect(openaiExport[0].content).toBe("Start the auth fix");
    expect(openaiExport[1].content).toBe("Looking at auth middleware now.");
    expect(openaiExport[2].content).toBe("Continue the fix");
    expect(openaiExport[3].content).toBe("Picking up where Claude left off.");

    // Export to Anthropic — same preservation
    const anthropicExport = anthropicAdapter.fromCanonical(mixedMessages, "full") as Array<{
      role: string;
      content: Array<{ text: string }>;
    }>;
    expect(anthropicExport).toHaveLength(4);
    expect(anthropicExport[0].content[0].text).toBe("Start the auth fix");
    expect(anthropicExport[3].content[0].text).toBe("Picking up where Claude left off.");
  });

  it("full multi-turn conversation with tool interactions across agents", () => {
    // Agent A (Claude) sends messages with tools
    const agentAMessages = [
      { role: "user", content: [{ type: "text", text: "Read the config file" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the configuration." },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/config.json" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"port": 3000}' }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The config has port 3000." }],
      },
    ];

    // Convert Agent A's messages to canonical
    const canonicalA = anthropicAdapter.toCanonical(agentAMessages);

    // Agent B (ChatGPT) adds more messages
    const agentBMessages = [
      { role: "user", content: "Now update the port to 4000" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_edit",
            type: "function",
            function: { name: "edit_file", arguments: '{"path":"/config.json","content":"{\\"port\\": 4000}"}' },
          },
        ],
      },
      { role: "tool", content: "File updated.", tool_call_id: "call_edit", name: "edit_file" },
      { role: "assistant", content: "Done. Port is now 4000." },
    ];

    const canonicalB = openaiAdapter.toCanonical(agentBMessages);

    // Merge both canonical sets (what the DB stores)
    const allCanonical = [...canonicalA, ...canonicalB];

    // Export full conversation to OpenAI format — everything should be present
    const openaiExport = openaiAdapter.fromCanonical(allCanonical, "full") as Array<{
      role: string;
      content: string | null;
    }>;
    expect(openaiExport.length).toBeGreaterThanOrEqual(6);
    expect(openaiExport[0].content).toBe("Read the config file");
    const lastMsg = openaiExport[openaiExport.length - 1];
    expect(lastMsg.content).toBe("Done. Port is now 4000.");

    // Export full conversation to Anthropic format — everything should be present
    const anthropicExport = anthropicAdapter.fromCanonical(allCanonical, "full") as Array<{
      role: string;
      content: string | Array<Record<string, unknown>>;
    }>;
    expect(anthropicExport.length).toBeGreaterThanOrEqual(6);
  });

  it("tool_interaction details are preserved through canonical storage", () => {
    // Simulate what the API does: messages come in, get stored as canonical, then exported
    const incomingMessages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Searching the codebase." },
          {
            type: "tool_use",
            id: "toolu_grep_1",
            name: "Grep",
            input: { pattern: "auth.*bug", path: "/src" },
          },
        ],
      },
    ];

    const canonical = anthropicAdapter.toCanonical(incomingMessages);

    // The tool interaction should be captured in canonical
    const toolMsg = canonical.find((m) => m.toolInteraction?.name === "Grep");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.toolInteraction?.input).toEqual({ pattern: "auth.*bug", path: "/src" });

    // Export to raw format preserves tool interaction exactly
    const rawExport = rawAdapter.fromCanonical(canonical, "full") as CanonicalMessage[];
    const rawToolMsg = rawExport.find((m) => m.toolInteraction?.name === "Grep");
    expect(rawToolMsg).toBeDefined();
    expect(rawToolMsg?.toolInteraction?.input).toEqual({ pattern: "auth.*bug", path: "/src" });
  });

  it("export to raw format preserves all canonical fields", () => {
    const canonical: CanonicalMessage[] = [
      makeCanonical({
        role: "user",
        content: "Fix the auth middleware bug",
        source: { agent: "claude-code" },
      }),
      makeCanonical({
        role: "assistant",
        content: "",
        source: { agent: "claude-code", model: "claude-opus-4-6" },
        toolInteraction: {
          name: "Read",
          input: { file_path: "/src/lib/auth.ts" },
          output: "export function authMiddleware() { /* ... */ }",
          summary: "Read auth.ts (120 lines)",
        },
      }),
      makeCanonical({
        role: "assistant",
        content: "Found the issue — missing expiry check.",
        source: { agent: "claude-code", model: "claude-opus-4-6" },
      }),
    ];

    const rawExport = rawAdapter.fromCanonical(canonical, "full") as CanonicalMessage[];
    expect(rawExport).toHaveLength(3);
    expect(rawExport[0].content).toBe("Fix the auth middleware bug");
    expect(rawExport[1].toolInteraction?.name).toBe("Read");
    expect(rawExport[1].toolInteraction?.input).toEqual({ file_path: "/src/lib/auth.ts" });
    expect(rawExport[2].content).toBe("Found the issue — missing expiry check.");
  });
});

// ============================================================
// 8. Fidelity mode roundtrip
// ============================================================

describe("Fidelity mode roundtrip", () => {
  const canonicalWithTool: CanonicalMessage[] = [
    makeCanonical({ role: "user", content: "Search for auth bugs" }),
    makeCanonical({
      role: "assistant",
      content: "",
      toolInteraction: {
        name: "Grep",
        input: { pattern: "auth.*bug", path: "/src" },
        output: "Found 3 matches in auth.ts, middleware.ts, login.ts",
        summary: "Grep for auth bugs (3 matches)",
      },
    }),
    makeCanonical({
      role: "tool",
      content: "Found 3 matches in auth.ts, middleware.ts, login.ts",
      toolInteraction: {
        name: "Grep",
        output: "Found 3 matches in auth.ts, middleware.ts, login.ts",
        summary: "Grep returned 3 matches",
      },
    }),
    makeCanonical({
      role: "assistant",
      content: "I found 3 files with potential auth bugs.",
    }),
  ];

  it("full fidelity: Anthropic export has tool_use blocks with input", () => {
    const result = anthropicAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;

    const toolUseMsg = result.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"));
    expect(toolUseMsg).toBeDefined();
    const toolBlock = toolUseMsg?.content.find((b) => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    expect(toolBlock?.name).toBe("Grep");
    expect(toolBlock?.input).toEqual({ pattern: "auth.*bug", path: "/src" });
  });

  it("full fidelity: OpenAI export has tool_calls with arguments", () => {
    const result = openaiAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    }>;

    const toolCallMsg = result.find((m) => m.tool_calls && m.tool_calls.length > 0);
    expect(toolCallMsg).toBeDefined();
    expect(toolCallMsg?.tool_calls?.[0].function.name).toBe("Grep");
    const args = JSON.parse(toolCallMsg?.tool_calls?.[0].function.arguments);
    expect(args).toEqual({ pattern: "auth.*bug", path: "/src" });
  });

  it("full fidelity: OpenAI export preserves tool result as tool role", () => {
    const result = openaiAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
      role: string;
      content: string;
      tool_call_id?: string;
    }>;

    const toolResult = result.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect(toolResult?.content).toContain("auth.ts");
  });

  it("summary fidelity: Anthropic export has only text blocks, no tool_use", () => {
    const result = anthropicAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
      role: string;
      content: Array<{ type: string; text: string }>;
    }>;

    for (const msg of result) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          expect(block.type).toBe("text");
        }
      }
    }

    // Tool interaction collapsed to text annotation
    const toolAnnotation = result.find(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.text.includes("[Tool:")),
    );
    expect(toolAnnotation).toBeDefined();
  });

  it("summary fidelity: OpenAI export has no tool_calls", () => {
    const result = openaiAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
      role: string;
      content: string;
      tool_calls?: unknown;
    }>;

    for (const msg of result) {
      expect(msg.tool_calls).toBeUndefined();
    }

    // Tool interaction becomes text annotation
    const toolAnnotation = result.find((m) => typeof m.content === "string" && m.content.includes("[Tool:"));
    expect(toolAnnotation).toBeDefined();
  });

  it("summary collapses tool_result into user-visible text", () => {
    const result = openaiAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
      role: string;
      content: string;
    }>;

    // Tool result should become a user message with [Tool Result: ...] annotation
    const toolResultAnnotation = result.find(
      (m) => typeof m.content === "string" && m.content.includes("[Tool Result:"),
    );
    expect(toolResultAnnotation).toBeDefined();
    expect(toolResultAnnotation?.role).toBe("user");
  });

  it("switching fidelity changes export format of same canonical data", () => {
    // Full fidelity has tool structures
    const fullOpenai = openaiAdapter.fromCanonical(canonicalWithTool, "full") as Array<{
      tool_calls?: unknown[];
    }>;
    const hasToolCalls = fullOpenai.some((m) => m.tool_calls && (m.tool_calls as unknown[]).length > 0);
    expect(hasToolCalls).toBe(true);

    // Summary fidelity does not
    const summaryOpenai = openaiAdapter.fromCanonical(canonicalWithTool, "summary") as Array<{
      tool_calls?: unknown[];
      content: string;
    }>;
    const hasToolCallsSummary = summaryOpenai.some((m) => m.tool_calls && (m.tool_calls as unknown[]).length > 0);
    expect(hasToolCallsSummary).toBe(false);

    // But summary still has the tool info as text
    const allText = summaryOpenai.map((m) => m.content).join(" ");
    expect(allText).toContain("[Tool:");
  });
});

// ============================================================
// 9. Format import/export roundtrip
// ============================================================

describe("Format import/export roundtrip", () => {
  it("Anthropic → canonical → OpenAI preserves user intent", () => {
    const anthropicMessages = [
      { role: "user", content: [{ type: "text", text: "What files are in the src directory?" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the directory listing." },
          { type: "tool_use", id: "toolu_abc123", name: "list_files", input: { path: "/src" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_abc123", content: "index.ts\napp.ts\nutils.ts" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The src directory contains: index.ts, app.ts, and utils.ts." }],
      },
    ];

    const canonical = anthropicAdapter.toCanonical(anthropicMessages);
    // Should have at least 4 canonical messages (user, text, tool_use, tool_result, assistant)
    expect(canonical.length).toBeGreaterThanOrEqual(4);

    // User question preserved
    expect(canonical[0].role).toBe("user");
    expect(canonical[0].content).toBe("What files are in the src directory?");

    // Tool interaction captured
    const toolCall = canonical.find((m) => m.toolInteraction?.name === "list_files");
    expect(toolCall).toBeTruthy();

    // Tool result captured
    const toolResult = canonical.find((m) => m.role === "tool");
    expect(toolResult).toBeTruthy();
    expect(toolResult?.content).toContain("index.ts");

    // Export to OpenAI
    const openaiExport = openaiAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: string | null;
    }>;
    expect(openaiExport.length).toBeGreaterThanOrEqual(1);

    // User message present in OpenAI format with string content
    const userMsg = openaiExport.find((m) => m.role === "user" && typeof m.content === "string");
    expect(userMsg).toBeTruthy();
  });

  it("OpenAI → canonical → Anthropic preserves user intent", () => {
    const openaiMessages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "What's the weather in SF?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_weather",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"San Francisco"}' },
          },
        ],
      },
      { role: "tool", content: "72F, sunny", tool_call_id: "call_weather", name: "get_weather" },
      { role: "assistant", content: "It's 72F and sunny in San Francisco." },
    ];

    const canonical = openaiAdapter.toCanonical(openaiMessages);
    expect(canonical.length).toBeGreaterThanOrEqual(4);

    // Export to Anthropic
    const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full") as Array<{
      role: string;
      content: string | Array<Record<string, unknown>>;
    }>;
    expect(anthropicExport.length).toBeGreaterThanOrEqual(3);

    // Anthropic skips system messages, so first should be user
    expect(anthropicExport[0].role).toBe("user");

    // Final answer preserved
    const lastMsg = anthropicExport[anthropicExport.length - 1];
    const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content[0] : lastMsg.content;
    const text = typeof lastContent === "string" ? lastContent : (lastContent as Record<string, unknown>).text;
    expect(text).toBe("It's 72F and sunny in San Francisco.");

    // Tool use block present
    const hasToolUse = anthropicExport.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"),
    );
    expect(hasToolUse).toBe(true);
  });

  it("Anthropic → canonical → OpenAI → canonical → Anthropic roundtrip preserves message count", () => {
    const anthropicOriginal = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
      { role: "user", content: [{ type: "text", text: "Help me debug" }] },
      { role: "assistant", content: [{ type: "text", text: "Sure, show me the error." }] },
    ];

    const canonical1 = anthropicAdapter.toCanonical(anthropicOriginal);
    const openaiExport = openaiAdapter.fromCanonical(canonical1, "full");
    const canonical2 = openaiAdapter.toCanonical(openaiExport);
    const anthropicFinal = anthropicAdapter.fromCanonical(canonical2, "full") as Array<{
      role: string;
      content: Array<{ text: string }>;
    }>;

    // Same number of semantic messages
    expect(anthropicFinal).toHaveLength(4);
    expect(anthropicFinal[0].content[0].text).toBe("Hello");
    expect(anthropicFinal[3].content[0].text).toBe("Sure, show me the error.");
  });

  it("OpenAI → canonical → Anthropic → canonical → OpenAI roundtrip preserves message count", () => {
    const openaiOriginal = [
      { role: "user", content: "What is TypeScript?" },
      { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
      { role: "user", content: "Show me an example." },
      { role: "assistant", content: "Here's a simple example: const x: number = 42;" },
    ];

    const canonical1 = openaiAdapter.toCanonical(openaiOriginal);
    const anthropicExport = anthropicAdapter.fromCanonical(canonical1, "full");
    const canonical2 = anthropicAdapter.toCanonical(anthropicExport);
    const openaiFinal = openaiAdapter.fromCanonical(canonical2, "full") as Array<{
      role: string;
      content: string;
    }>;

    // Same number of semantic messages
    expect(openaiFinal).toHaveLength(4);
    expect(openaiFinal[0].content).toBe("What is TypeScript?");
    expect(openaiFinal[3].content).toBe("Here's a simple example: const x: number = 42;");
  });

  it("Anthropic messages exported to both formats and re-imported produce consistent canonical", () => {
    const anthropicMessages = [
      { role: "user", content: [{ type: "text", text: "Explain adapters" }] },
      { role: "assistant", content: [{ type: "text", text: "Adapters convert interfaces." }] },
    ];

    const canonical = anthropicAdapter.toCanonical(anthropicMessages);

    // Export to OpenAI and re-import
    const openaiExport = openaiAdapter.fromCanonical(canonical, "full");
    const reimportedFromOpenai = openaiAdapter.toCanonical(openaiExport);

    // Export to Anthropic and re-import
    const anthropicExport = anthropicAdapter.fromCanonical(canonical, "full");
    const reimportedFromAnthropic = anthropicAdapter.toCanonical(anthropicExport);

    // Both re-imports should have same message count and content
    expect(reimportedFromOpenai.length).toBe(reimportedFromAnthropic.length);
    expect(reimportedFromOpenai[0].content).toBe(reimportedFromAnthropic[0].content);
    expect(reimportedFromOpenai[1].content).toBe(reimportedFromAnthropic[1].content);
  });
});

// ============================================================
// 10. Working context simulation
// ============================================================

describe("Working context simulation", () => {
  it("working context fields survive canonical roundtrip via raw adapter", () => {
    // Working context is stored as conversation metadata, but we can verify
    // that canonical messages with source metadata survive roundtrip
    const messagesWithContext: CanonicalMessage[] = [
      makeCanonical({
        role: "user",
        content: "Switching to feature branch",
        source: { agent: "claude-code" },
      }),
      makeCanonical({
        role: "assistant",
        content: "I see you switched to feature/auth-fix.",
        source: { agent: "claude-code", model: "claude-opus-4-6" },
      }),
    ];

    // Raw adapter preserves source metadata
    const rawExport = rawAdapter.fromCanonical(messagesWithContext, "full") as CanonicalMessage[];
    expect(rawExport[0].source?.agent).toBe("claude-code");
    expect(rawExport[1].source?.model).toBe("claude-opus-4-6");
  });

  it("context entries can be represented as canonical messages", () => {
    // Context entries (like branch, env vars) are typically stored separately,
    // but they can also appear as user messages in the conversation
    const contextMessages = [
      makeCanonical({
        role: "user",
        content: "Switching to feature branch",
        source: { agent: "claude-code" },
      }),
    ];

    // Export to both formats — content preserved
    const openaiExport = openaiAdapter.fromCanonical(contextMessages, "full") as Array<{
      role: string;
      content: string;
    }>;
    expect(openaiExport[0].content).toBe("Switching to feature branch");

    const anthropicExport = anthropicAdapter.fromCanonical(contextMessages, "full") as Array<{
      role: string;
      content: Array<{ text: string }>;
    }>;
    expect(anthropicExport[0].content[0].text).toBe("Switching to feature branch");
  });

  it("messages from different sessions maintain ordering in canonical", () => {
    // Simulate messages from multiple sessions appended in order
    const session1 = [
      makeCanonical({
        id: "s1-1",
        role: "user",
        content: "Start working on auth",
        source: { agent: "claude-code" },
        createdAt: "2026-01-01T10:00:00Z",
      }),
      makeCanonical({
        id: "s1-2",
        role: "assistant",
        content: "On it.",
        source: { agent: "claude-code" },
        createdAt: "2026-01-01T10:00:01Z",
      }),
    ];

    const session2 = [
      makeCanonical({
        id: "s2-1",
        role: "user",
        content: "Continue the auth work",
        source: { agent: "cursor" },
        createdAt: "2026-01-01T11:00:00Z",
      }),
      makeCanonical({
        id: "s2-2",
        role: "assistant",
        content: "Continuing from where Claude left off.",
        source: { agent: "cursor" },
        createdAt: "2026-01-01T11:00:01Z",
      }),
    ];

    const allMessages = [...session1, ...session2];

    // Export to OpenAI format — ordering maintained
    const openaiExport = openaiAdapter.fromCanonical(allMessages, "full") as Array<{
      role: string;
      content: string;
    }>;
    expect(openaiExport).toHaveLength(4);
    expect(openaiExport[0].content).toBe("Start working on auth");
    expect(openaiExport[1].content).toBe("On it.");
    expect(openaiExport[2].content).toBe("Continue the auth work");
    expect(openaiExport[3].content).toBe("Continuing from where Claude left off.");
  });

  it("empty working context does not affect message conversion", () => {
    const messages: CanonicalMessage[] = [
      makeCanonical({ role: "user", content: "Hello" }),
      makeCanonical({ role: "assistant", content: "Hi there" }),
    ];

    // No context metadata — messages should still convert cleanly
    const openaiExport = openaiAdapter.fromCanonical(messages, "full") as Array<{
      role: string;
      content: string;
    }>;
    expect(openaiExport).toHaveLength(2);

    const anthropicExport = anthropicAdapter.fromCanonical(messages, "full") as Array<{
      role: string;
      content: Array<{ text: string }>;
    }>;
    expect(anthropicExport).toHaveLength(2);
  });

  it("conversation with tool interactions and context metadata exports cleanly", () => {
    const messages: CanonicalMessage[] = [
      makeCanonical({
        role: "user",
        content: "Check the current branch",
        source: { agent: "claude-code" },
      }),
      makeCanonical({
        role: "assistant",
        content: "",
        source: { agent: "claude-code" },
        toolInteraction: {
          name: "Bash",
          input: { command: "git branch --show-current" },
          output: "feature/auth-fix",
          summary: "Current branch: feature/auth-fix",
        },
      }),
      makeCanonical({
        role: "assistant",
        content: "You're on the feature/auth-fix branch.",
        source: { agent: "claude-code" },
      }),
    ];

    // Full fidelity preserves tool interaction
    const fullExport = openaiAdapter.fromCanonical(messages, "full") as Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<{ function: { name: string } }>;
    }>;
    const hasToolCall = fullExport.some((m) => m.tool_calls && m.tool_calls.length > 0);
    expect(hasToolCall).toBe(true);

    // Summary fidelity collapses tool to text
    const summaryExport = openaiAdapter.fromCanonical(messages, "summary") as Array<{
      role: string;
      content: string;
      tool_calls?: unknown;
    }>;
    for (const msg of summaryExport) {
      expect(msg.tool_calls).toBeUndefined();
    }
    const allText = summaryExport.map((m) => m.content).join(" ");
    expect(allText).toContain("[Tool:");
  });
});
