import { describe, expect, it } from "vitest";
import { chatgptAdapter, parseChatGPTRequest, parseChatGPTResponse } from "../../src/content/adapters/chatgpt.js";
import chatgptFixture from "./fixtures/chatgpt-conversation.json";

// Classic streaming: each event carries the full text so far in content.parts.
function buildCumulativeSSE(snapshots: string[]): string {
  const events = snapshots.map(
    (text) =>
      `data: ${JSON.stringify({
        message: { author: { role: "assistant" }, content: { content_type: "text", parts: [text] } },
      })}`,
  );
  return `${[...events, "data: [DONE]"].join("\n\n")}\n`;
}

// Delta streaming: append operations on the parts path.
function buildAppendSSE(deltas: string[]): string {
  const events = deltas.map((v) => `data: ${JSON.stringify({ o: "append", p: "/message/content/parts/0", v })}`);
  return `${[...events, "data: [DONE]"].join("\n\n")}\n`;
}

describe("chatgpt adapter", () => {
  it("matchesCompletion only on the conversation endpoint", () => {
    expect(chatgptAdapter.matchesCompletion("/backend-api/conversation")).toBe(true);
    expect(chatgptAdapter.matchesCompletion("/backend-api/f/conversation")).toBe(true);
    expect(chatgptAdapter.matchesCompletion("/backend-api/me")).toBe(false);
  });

  it("reassembles the assistant turn from cumulative parts snapshots", () => {
    const turn = parseChatGPTResponse(buildCumulativeSSE(chatgptFixture.snapshots));
    expect(turn).toEqual({ role: "assistant", content: chatgptFixture.expectedAssistant });
  });

  it("reassembles the assistant turn from delta append events", () => {
    const turn = parseChatGPTResponse(buildAppendSSE(chatgptFixture.appendDeltas));
    expect(turn).toEqual({ role: "assistant", content: chatgptFixture.expectedAssistant });
  });

  it("extracts the user turn from messages[].content.parts", () => {
    const body = {
      messages: [{ author: { role: "user" }, content: { content_type: "text", parts: ["say hello"] } }],
    };
    expect(parseChatGPTRequest(body)).toEqual({ role: "user", content: "say hello" });
  });

  it("returns null when nothing parses", () => {
    expect(parseChatGPTResponse("data: [DONE]\n")).toBeNull();
  });
});
