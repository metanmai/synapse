import { CAPTURE_HOSTS, HOST_TOOL, isCaptureHost } from "@synapse/shared/capture-hosts.js";
import { describe, expect, it } from "vitest";

describe("CAPTURE_HOSTS", () => {
  it("includes the committed browser hosts", () => {
    expect(CAPTURE_HOSTS).toContain("claude.ai");
    expect(CAPTURE_HOSTS).toContain("chatgpt.com");
  });

  it("isCaptureHost matches exact host, rejects lookalikes", () => {
    expect(isCaptureHost("claude.ai")).toBe(true);
    expect(isCaptureHost("chatgpt.com")).toBe(true);
    expect(isCaptureHost("evil-claude.ai.attacker.com")).toBe(false);
    expect(isCaptureHost("notclaude.ai")).toBe(false);
    expect(isCaptureHost("claude.ai.evil.com")).toBe(false);
  });

  it("HOST_TOOL maps every capture host to a non-empty tool tag", () => {
    for (const host of CAPTURE_HOSTS) {
      expect(HOST_TOOL[host]).toBeTruthy();
    }
    expect(HOST_TOOL["claude.ai"]).toBe("claude-ai");
    expect(HOST_TOOL["chatgpt.com"]).toBe("chatgpt");
  });
});
