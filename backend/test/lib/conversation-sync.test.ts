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
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: '{"port": 3000}' },
          ],
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

        const toolUseMsg = result.find(
          (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"),
        );
        expect(toolUseMsg).toBeDefined();
        const toolBlock = toolUseMsg!.content.find((b) => b.type === "tool_use");
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
        expect(toolCallMsg!.tool_calls![0].function.name).toBe("Grep");
        const args = JSON.parse(toolCallMsg!.tool_calls![0].function.arguments);
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
        expect(toolResult!.content).toContain("auth.ts");
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
        expect(toolResultAnnotation!.role).toBe("user");
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
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "test", arguments: "{}" } },
          ],
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
      expect(rawResult[0].media![0].filename).toBe("screenshot.png");
      expect(rawResult[0].media![0].type).toBe("image");
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
      const unicodeContent = "Hello \u{1F44B} \u4F60\u597D \u041F\u0440\u0438\u0432\u0435\u0442 \uD55C\uAD6D\uC5B4 \u2603\uFE0F\u2744\uFE0F\u2728";
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
      expect(openaiResult[0].tool_calls![0].function.name).toBe("long_running_task");

      const anthropicResult = anthropicAdapter.fromCanonical([pendingTool], "full") as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      expect(anthropicResult).toHaveLength(1);
      const toolBlock = anthropicResult[0].content.find((b) => b.type === "tool_use");
      expect(toolBlock).toBeDefined();
      expect(toolBlock!.name).toBe("long_running_task");
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
      expect(openaiResult[0].tool_calls![0].function.arguments).toBe("{}");
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
