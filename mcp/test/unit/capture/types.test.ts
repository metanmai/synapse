import { describe, expect, it } from "vitest";
import { sessionIdFromNative } from "../../../src/capture/types.js";

describe("sessionIdFromNative", () => {
  it("strips dashes and prefixes with ses_", () => {
    expect(sessionIdFromNative("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("ses_a1b2c3d4e5f67890");
  });

  it("takes only the first 16 characters after stripping dashes", () => {
    const result = sessionIdFromNative("a1b2c3d4e5f67890abcdef1234567890");
    expect(result).toBe("ses_a1b2c3d4e5f67890");
  });

  it("handles short IDs without truncation", () => {
    expect(sessionIdFromNative("abc123")).toBe("ses_abc123");
  });

  it("handles IDs with no dashes", () => {
    expect(sessionIdFromNative("a1b2c3d4e5f67890")).toBe("ses_a1b2c3d4e5f67890");
  });

  it("handles IDs that are all dashes", () => {
    expect(sessionIdFromNative("----")).toBe("ses_");
  });

  it("handles empty string", () => {
    expect(sessionIdFromNative("")).toBe("ses_");
  });
});
