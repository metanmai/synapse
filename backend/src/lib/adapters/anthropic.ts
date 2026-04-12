import type { CanonicalMessage, FidelityMode, AgentAdapter } from "./types";

// --- Anthropic API message format types ---

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

// --- Detection helpers ---

function isContentBlockArray(content: unknown): content is AnthropicContentBlock[] {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      typeof (block as Record<string, unknown>).type === "string"
  );
}

function isAnthropicMessage(msg: unknown): msg is AnthropicMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (typeof obj.role !== "string") return false;
  // Anthropic messages have content as array of typed blocks
  return isContentBlockArray(obj.content);
}

// --- Adapter ---

function extractTextFromBlocks(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function generateId(): string {
  return crypto.randomUUID();
}

export const anthropicAdapter: AgentAdapter = {
  name: "anthropic",

  detect(raw: unknown): boolean {
    if (!Array.isArray(raw) || raw.length === 0) return false;
    // At least one message must have content as an array of typed blocks
    return raw.some((msg) => isAnthropicMessage(msg));
  },

  toCanonical(raw: unknown): CanonicalMessage[] {
    if (!Array.isArray(raw)) return [];
    const messages: CanonicalMessage[] = [];

    for (const msg of raw) {
      if (typeof msg !== "object" || msg === null) continue;
      const obj = msg as Record<string, unknown>;
      if (typeof obj.role !== "string") continue;
      const role = obj.role;

      // Handle string content (Anthropic supports this for user messages)
      if (typeof obj.content === "string") {
        messages.push({
          id: generateId(),
          role: role === "user" ? "user" : "assistant",
          content: obj.content,
          source: { agent: "anthropic" },
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      if (!isContentBlockArray(obj.content)) continue;
      const blocks = obj.content;

      // Extract text content
      const textContent = extractTextFromBlocks(blocks);

      // Extract tool_use blocks
      const toolUseBlocks = blocks.filter(
        (b): b is AnthropicToolUseBlock => b.type === "tool_use"
      );

      // Extract tool_result blocks
      const toolResultBlocks = blocks.filter(
        (b): b is AnthropicToolResultBlock => b.type === "tool_result"
      );

      if (toolUseBlocks.length > 0) {
        // For messages with tool_use, create a message for each tool call
        // First emit any text content
        if (textContent) {
          messages.push({
            id: generateId(),
            role: role === "user" ? "user" : "assistant",
            content: textContent,
            source: { agent: "anthropic" },
            createdAt: new Date().toISOString(),
          });
        }

        for (const toolBlock of toolUseBlocks) {
          messages.push({
            id: generateId(),
            role: "assistant",
            content: "",
            toolInteraction: {
              name: toolBlock.name,
              input: toolBlock.input,
              summary: `Called ${toolBlock.name}`,
            },
            source: { agent: "anthropic" },
            createdAt: new Date().toISOString(),
          });
        }
      } else if (toolResultBlocks.length > 0) {
        // Tool result messages
        for (const resultBlock of toolResultBlocks) {
          const resultContent =
            typeof resultBlock.content === "string"
              ? resultBlock.content
              : Array.isArray(resultBlock.content)
                ? extractTextFromBlocks(resultBlock.content)
                : "";

          messages.push({
            id: generateId(),
            role: "tool",
            content: resultContent,
            toolInteraction: {
              name: resultBlock.tool_use_id,
              output: resultContent,
              summary: `Result for ${resultBlock.tool_use_id}`,
            },
            source: { agent: "anthropic" },
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        // Plain text message
        messages.push({
          id: generateId(),
          role: role === "user" ? "user" : "assistant",
          content: textContent,
          source: { agent: "anthropic" },
          createdAt: new Date().toISOString(),
        });
      }
    }

    return messages;
  },

  fromCanonical(
    messages: CanonicalMessage[],
    fidelity: FidelityMode
  ): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        // Anthropic doesn't have system role in messages array;
        // system prompt is a separate top-level field. Skip or convert to user.
        continue;
      }

      if (msg.role === "tool") {
        // Tool result message
        if (fidelity === "summary") {
          // In summary mode, tool results are collapsed into text
          result.push({
            role: "user",
            content: [
              {
                type: "text",
                text: msg.toolInteraction
                  ? `[Tool Result: ${msg.toolInteraction.summary}]`
                  : msg.content,
              },
            ],
          });
        } else {
          // Full fidelity — emit as tool_result block
          result.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: msg.toolInteraction?.name ?? "unknown",
                content: msg.content || msg.toolInteraction?.output,
              },
            ],
          });
        }
        continue;
      }

      const anthropicRole: "user" | "assistant" =
        msg.role === "user" ? "user" : "assistant";

      if (msg.toolInteraction && fidelity === "full") {
        // Full fidelity — reconstruct tool_use blocks
        const blocks: AnthropicContentBlock[] = [];

        if (msg.content) {
          blocks.push({ type: "text", text: msg.content });
        }

        blocks.push({
          type: "tool_use",
          id: `toolu_${msg.id}`,
          name: msg.toolInteraction.name,
          input: msg.toolInteraction.input ?? {},
        });

        result.push({ role: anthropicRole, content: blocks });
      } else if (msg.toolInteraction && fidelity === "summary") {
        // Summary fidelity — tool interactions become text annotations
        const parts: string[] = [];
        if (msg.content) parts.push(msg.content);
        parts.push(`[Tool: ${msg.toolInteraction.summary}]`);

        result.push({
          role: anthropicRole,
          content: [{ type: "text", text: parts.join("\n") }],
        });
      } else {
        // Plain text message
        result.push({
          role: anthropicRole,
          content: [{ type: "text", text: msg.content }],
        });
      }
    }

    return result;
  },
};
