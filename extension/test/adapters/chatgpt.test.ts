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

// New "add" snapshot (drift, 2026-06): {o:"add", v:{message:{author:{role}, content:{parts:[text]}}}}
function buildAddSSE(text: string): string {
  const evt = {
    o: "add",
    v: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: [text] } } },
  };
  return `data: ${JSON.stringify(evt)}\n\ndata: [DONE]\n`;
}

// New "patch" streaming (drift, 2026-06): {o:"patch", v:[{p:"/message/content/parts/0", o:"append", v:chunk}]}
function buildPatchSSE(chunks: string[]): string {
  const events = chunks.map(
    (v) => `data: ${JSON.stringify({ o: "patch", v: [{ p: "/message/content/parts/0", o: "append", v }] })}`,
  );
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

  it("reassembles the assistant turn from the new o:'add' snapshot format", () => {
    const turn = parseChatGPTResponse(buildAddSSE(chatgptFixture.expectedAssistant));
    expect(turn).toEqual({ role: "assistant", content: chatgptFixture.expectedAssistant });
  });

  it("reassembles the assistant turn from the new o:'patch' streaming format", () => {
    const txt: string = chatgptFixture.expectedAssistant;
    const turn = parseChatGPTResponse(buildPatchSSE([txt.slice(0, 12), txt.slice(12)]));
    expect(turn).toEqual({ role: "assistant", content: txt });
  });

  it("does not leak stray string-valued events that lack a parts path", () => {
    const txt: string = chatgptFixture.expectedAssistant;
    const sse = [
      `data: ${JSON.stringify({ o: "patch", v: [{ p: "/message/content/parts/0", o: "append", v: txt }] })}`,
      `data: ${JSON.stringify({ v: "LEAKED_GARBAGE" })}`, // bare value, no o/p → must be ignored
      "data: [DONE]",
    ].join("\n\n");
    const turn = parseChatGPTResponse(sse);
    expect(turn?.content).toBe(txt);
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
