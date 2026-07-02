import { describe, expect, it } from "vitest";
import { scrubSecretValues } from "../../src/capture/ingest/redact.js";

describe("scrubSecretValues", () => {
  it("redacts token-shaped values inside a string regardless of surrounding key", () => {
    const s = "my key is sk-live-abc123def456ghi789 and auth Bearer eyJhbGciOiJ.payload.sig";
    const out = scrubSecretValues(s);
    expect(out).not.toContain("sk-live-abc123def456ghi789");
    expect(out).not.toContain("eyJhbGciOiJ.payload.sig");
    expect(out).toContain("my key is"); // surrounding prose preserved
  });

  it("redacts cookie-shaped pairs", () => {
    expect(scrubSecretValues("sessionKey=abc123def456")).not.toContain("abc123def456");
  });

  it("leaves ordinary conversation text untouched", () => {
    expect(scrubSecretValues("how do I write a for loop")).toBe("how do I write a for loop");
  });
});
