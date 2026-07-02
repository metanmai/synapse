import { describe, expect, it } from "vitest";
import { type BufferedTurn, CaptureBuffer } from "../src/worker/buffer.js";

const turn = (content: string, role: "user" | "assistant" = "user"): BufferedTurn => ({
  host: "claude.ai",
  role,
  content,
  ts: "2026-06-11T00:00:00Z",
});

describe("CaptureBuffer", () => {
  it("dedupes identical turns", () => {
    const b = new CaptureBuffer();
    expect(b.add(turn("hi"))).toBe(true);
    expect(b.add(turn("hi"))).toBe(false);
    expect(b.size).toBe(1);
  });

  it("drops the oldest turns beyond the cap (daemon-down policy)", () => {
    const b = new CaptureBuffer(2);
    b.add(turn("a"));
    b.add(turn("b"));
    b.add(turn("c"));
    expect(b.size).toBe(2);
    expect(b.drain().map((t) => t.content)).toEqual(["b", "c"]);
  });

  it("survives a round-trip through storage (MV3 eviction recovery)", () => {
    const b = new CaptureBuffer();
    b.add(turn("x"));
    b.add(turn("y"));
    const restored = CaptureBuffer.fromJSON(b.toJSON());
    expect(restored.size).toBe(2);
    // dedupe state is restored too — a re-sent turn is not double-buffered
    expect(restored.add(turn("x"))).toBe(false);
  });

  it("drain empties the buffer", () => {
    const b = new CaptureBuffer();
    b.add(turn("one"));
    expect(b.drain()).toHaveLength(1);
    expect(b.size).toBe(0);
  });
});
