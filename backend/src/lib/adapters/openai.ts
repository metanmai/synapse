import type { AgentAdapter, CanonicalMessage, FidelityMode } from "./types";

// --- OpenAI API message format types ---

interface OpenAIFunctionCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIFunctionCall[];
  tool_call_id?: string;
  name?: string;
}

// --- Detection helpers ---

function isOpenAIMessage(msg: unknown): msg is OpenAIMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (typeof obj.role !== "string") return false;
  // OpenAI messages have content as string or null
  // and do NOT have content as array of typed blocks (that's Anthropic)
  if (Array.isArray(obj.content)) return false;
  return obj.content === null || typeof obj.content === "string";
}

// --- Adapter ---

function generateId(): string {
  return crypto.randomUUID();
}

function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return { raw: str };
  }
}

export const openaiAdapter: AgentAdapter = {
  name: "openai",

  detect(raw: unknown): boolean {
    if (!Array.isArray(raw) || raw.length === 0) return false;
    // At least one message must look like an OpenAI message
    // (string or null content, no Anthropic-style content blocks)
    return raw.some((msg) => isOpenAIMessage(msg));
  },

  toCanonical(raw: unknown): CanonicalMessage[] {
    if (!Array.isArray(raw)) return [];
    const messages: CanonicalMessage[] = [];

    for (const msg of raw) {
      if (typeof msg !== "object" || msg === null) continue;
      const obj = msg as OpenAIMessage;
      const role = obj.role;

      // Handle tool role messages (tool results)
      if (role === "tool") {
        messages.push({
          id: generateId(),
          role: "tool",
          content: obj.content ?? "",
          toolInteraction: {
            name: obj.tool_call_id ?? obj.name ?? "unknown",
            output: obj.content ?? undefined,
            summary: `Result for ${obj.name ?? obj.tool_call_id ?? "tool"}`,
          },
          source: { agent: "openai" },
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      // Handle tool_calls on assistant messages
      if (obj.tool_calls && obj.tool_calls.length > 0) {
        // Emit text content first if present
        if (obj.content) {
          messages.push({
            id: generateId(),
            role: "assistant",
            content: obj.content,
            source: { agent: "openai" },
            createdAt: new Date().toISOString(),
          });
        }

        for (const toolCall of obj.tool_calls) {
          const parsedArgs = safeParseJson(toolCall.function.arguments);
          messages.push({
            id: generateId(),
            role: "assistant",
            content: "",
            toolInteraction: {
              name: toolCall.function.name,
              input: parsedArgs,
              summary: `Called ${toolCall.function.name}`,
            },
            source: { agent: "openai" },
            createdAt: new Date().toISOString(),
          });
        }
        continue;
      }

      // Map role
      const canonicalRole: CanonicalMessage["role"] =
        role === "system" ? "system" : role === "user" ? "user" : "assistant";

      messages.push({
        id: generateId(),
        role: canonicalRole,
        content: obj.content ?? "",
        source: { agent: "openai" },
        createdAt: new Date().toISOString(),
      });
    }

    return messages;
  },

  fromCanonical(messages: CanonicalMessage[], fidelity: FidelityMode): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "tool") {
        if (fidelity === "summary") {
          // In summary mode, tool results become user-visible text
          result.push({
            role: "user",
            content: msg.toolInteraction ? `[Tool Result: ${msg.toolInteraction.summary}]` : msg.content,
          });
        } else {
          // Full fidelity — preserve as tool role message
          result.push({
            role: "tool",
            content: msg.content || msg.toolInteraction?.output || "",
            tool_call_id: msg.toolInteraction?.name ?? "unknown",
          });
        }
        continue;
      }

      if (msg.role === "system") {
        result.push({
          role: "system",
          content: msg.content,
        });
        continue;
      }

      const openaiRole: "user" | "assistant" = msg.role === "user" ? "user" : "assistant";

      if (msg.toolInteraction && fidelity === "full") {
        // Full fidelity — reconstruct tool_calls
        result.push({
          role: openaiRole,
          content: msg.content || null,
          tool_calls: [
            {
              id: `call_${msg.id}`,
              type: "function",
              function: {
                name: msg.toolInteraction.name,
                arguments: JSON.stringify(msg.toolInteraction.input ?? {}),
              },
            },
          ],
        });
      } else if (msg.toolInteraction && fidelity === "summary") {
        // Summary fidelity — tool interactions appended to content
        const parts: string[] = [];
        if (msg.content) parts.push(msg.content);
        parts.push(`[Tool: ${msg.toolInteraction.summary}]`);
        result.push({
          role: openaiRole,
          content: parts.join("\n"),
        });
      } else {
        // Plain text message
        result.push({
          role: openaiRole,
          content: msg.content,
        });
      }
    }

    return result;
  },
};
