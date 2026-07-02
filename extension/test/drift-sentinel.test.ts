import { describe, expect, it } from "vitest";
import { createDriftSentinel } from "../src/content/drift-sentinel.js";

const matchedEmpty = { matched: true, hadBody: true, parsedOk: false };
const matchedOk = { matched: true, hadBody: true, parsedOk: true };

describe("drift sentinel", () => {
  it("fires after threshold consecutive matched-but-empty completions", () => {
    const s = createDriftSentinel({ threshold: 3 });
    expect(s.record("claude.ai", matchedEmpty)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBe("drift");
  });

  it("resets on any successful parse", () => {
    const s = createDriftSentinel({ threshold: 3 });
    s.record("claude.ai", matchedEmpty);
    s.record("claude.ai", matchedEmpty);
    expect(s.record("claude.ai", matchedOk)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBeNull(); // counter restarted
  });

  it("ignores unmatched requests and empty bodies (no drift evidence)", () => {
    const s = createDriftSentinel({ threshold: 2 });
    s.record("claude.ai", { matched: false, hadBody: true, parsedOk: false });
    s.record("claude.ai", { matched: true, hadBody: false, parsedOk: false });
    expect(s.record("claude.ai", matchedEmpty)).toBeNull(); // only 1 real strike
  });

  it("tracks hosts independently", () => {
    const s = createDriftSentinel({ threshold: 2 });
    expect(s.record("claude.ai", matchedEmpty)).toBeNull();
    expect(s.record("chatgpt.com", matchedEmpty)).toBeNull();
    expect(s.record("claude.ai", matchedEmpty)).toBe("drift");
  });

  it("re-arms after firing (does not spam every subsequent call)", () => {
    const s = createDriftSentinel({ threshold: 2 });
    s.record("claude.ai", matchedEmpty);
    expect(s.record("claude.ai", matchedEmpty)).toBe("drift");
    expect(s.record("claude.ai", matchedEmpty)).toBeNull(); // counter reset after fire
  });
});
