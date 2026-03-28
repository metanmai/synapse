import { describe, expect, it } from "vitest";
import { introFrames, spinnerFrames } from "../../src/cli/glyph.js";

describe("introFrames()", () => {
  it("returns an array of 4 frames", () => {
    const frames = introFrames();
    expect(frames).toHaveLength(4);
  });

  it("each frame is an array of 3 strings (3 lines per frame)", () => {
    const frames = introFrames();
    for (const frame of frames) {
      expect(Array.isArray(frame)).toBe(true);
      expect(frame).toHaveLength(3);
      for (const line of frame) {
        expect(typeof line).toBe("string");
      }
    }
  });

  it("all frames contain the diamond character", () => {
    const frames = introFrames();
    for (const frame of frames) {
      // At least one line in the frame should contain the diamond
      const combined = frame.join("");
      expect(combined).toContain("\u25C6"); // ◆
    }
  });

  it("returns a new array on each call (no shared reference)", () => {
    const a = introFrames();
    const b = introFrames();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("spinnerFrames()", () => {
  it("returns an array of 4 strings", () => {
    const frames = spinnerFrames();
    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect(typeof frame).toBe("string");
    }
  });

  it("all spinner frames are non-empty strings", () => {
    const frames = spinnerFrames();
    for (const frame of frames) {
      expect(frame.length).toBeGreaterThan(0);
    }
  });

  it("all spinner frames contain the diamond character", () => {
    const frames = spinnerFrames();
    for (const frame of frames) {
      expect(frame).toContain("\u25C6"); // ◆
    }
  });

  it("returns a new array on each call (no shared reference)", () => {
    const a = spinnerFrames();
    const b = spinnerFrames();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
