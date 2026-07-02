import { describe, expect, it } from "vitest";
import { summarizeShape } from "../src/content/drift-shape.js";

const SSE = [
  'event: message_start\ndata: {"type":"message_start"}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"SECRET ASSISTANT TEXT"}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
].join("\n\n");

describe("summarizeShape", () => {
  it("extracts unique SSE event names, sorted", () => {
    const s = summarizeShape(SSE);
    expect(s.eventNames).toEqual(["content_block_delta", "message_start", "message_stop"]);
  });

  it("never leaks message content — emits structural event names only", () => {
    const s = summarizeShape(SSE);
    const json = JSON.stringify(s);
    // The assistant's words and the data-payload JSON must never appear...
    expect(json).not.toContain("SECRET ASSISTANT TEXT");
    expect(json).not.toContain('"type"'); // data: payload key
    expect(json).not.toContain('"delta"'); // data: object — distinct from the event NAME content_block_delta
    // ...but the structural event names ARE carried (that's the whole signal).
    expect(s.eventNames).toContain("content_block_delta");
  });

  it("reports byte length and a stable one-way hash", () => {
    const a = summarizeShape(SSE);
    const b = summarizeShape(SSE);
    expect(a.byteLength).toBe(SSE.length);
    expect(a.sampleHash).toBe(b.sampleHash);
    expect(a.sampleHash).not.toBe(summarizeShape(`${SSE}x`).sampleHash);
  });

  it("caps event names so a pathological body can't bloat the signal", () => {
    const many = Array.from({ length: 100 }, (_, i) => `event: e${i}\ndata: {}`).join("\n\n");
    expect(summarizeShape(many).eventNames.length).toBeLessThanOrEqual(20);
  });
});
