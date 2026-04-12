import { describe, expect, it } from "vitest";
import {
  defaultToolBadge,
  formatMessageTime,
  formatRelativeDate,
  getToolBadge,
  getToolLabel,
  toolBadgeColors,
  toolSummary,
} from "./conversation-helpers";

// ---------- formatRelativeDate ----------

describe("formatRelativeDate", () => {
  const now = new Date("2026-03-28T12:00:00Z");

  it('returns "Just now" for timestamps less than 1 minute ago', () => {
    const recent = new Date(now.getTime() - 30_000).toISOString(); // 30 seconds ago
    expect(formatRelativeDate(recent, now)).toBe("Just now");
  });

  it('returns "Just now" for timestamps 0 seconds ago', () => {
    expect(formatRelativeDate(now.toISOString(), now)).toBe("Just now");
  });

  it("returns minutes ago for timestamps 1-59 minutes old", () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatRelativeDate(fiveMinAgo, now)).toBe("5m ago");
  });

  it("returns 1m ago at exactly 1 minute", () => {
    const oneMinAgo = new Date(now.getTime() - 60_000).toISOString();
    expect(formatRelativeDate(oneMinAgo, now)).toBe("1m ago");
  });

  it("returns 59m ago at 59 minutes", () => {
    const fiftyNineMinAgo = new Date(now.getTime() - 59 * 60_000).toISOString();
    expect(formatRelativeDate(fiftyNineMinAgo, now)).toBe("59m ago");
  });

  it("returns hours ago for timestamps 1-23 hours old", () => {
    const threeHoursAgo = new Date(now.getTime() - 3 * 3600_000).toISOString();
    expect(formatRelativeDate(threeHoursAgo, now)).toBe("3h ago");
  });

  it("returns 1h ago at exactly 60 minutes", () => {
    const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString();
    expect(formatRelativeDate(oneHourAgo, now)).toBe("1h ago");
  });

  it("returns days ago for timestamps 1-6 days old", () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000).toISOString();
    expect(formatRelativeDate(twoDaysAgo, now)).toBe("2d ago");
  });

  it("returns formatted date for timestamps 7+ days old in same year", () => {
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400_000).toISOString();
    const result = formatRelativeDate(twoWeeksAgo, now);
    // Should contain month abbreviation and day, but not year (same year)
    expect(result).toMatch(/Mar\s+14/);
  });

  it("includes year for timestamps from a different year", () => {
    const lastYear = new Date("2025-06-15T10:00:00Z").toISOString();
    const result = formatRelativeDate(lastYear, now);
    expect(result).toMatch(/2025/);
  });

  it("does not include year for timestamps in the same year beyond 7 days", () => {
    const sameYearOld = new Date("2026-01-15T10:00:00Z").toISOString();
    const result = formatRelativeDate(sameYearOld, now);
    // Should have Jan 15 but NOT 2026
    expect(result).toMatch(/Jan\s+15/);
    expect(result).not.toMatch(/2026/);
  });
});

// ---------- formatMessageTime ----------

describe("formatMessageTime", () => {
  it("formats ISO timestamp to locale string", () => {
    const result = formatMessageTime("2026-03-28T14:30:00Z");
    // Should contain month, day, and time
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("produces consistent output for same input", () => {
    const iso = "2026-01-15T09:45:00Z";
    expect(formatMessageTime(iso)).toBe(formatMessageTime(iso));
  });
});

// ---------- toolSummary ----------

describe("toolSummary", () => {
  it("returns empty string when tool_interaction is null", () => {
    expect(toolSummary({ tool_interaction: null })).toBe("");
  });

  it("returns summary when tool_interaction has a summary", () => {
    const msg = {
      tool_interaction: {
        name: "read_file",
        summary: "Read the contents of config.ts",
      },
    };
    expect(toolSummary(msg)).toBe("Read the contents of config.ts");
  });

  it("returns fallback when summary is empty", () => {
    const msg = {
      tool_interaction: {
        name: "write_file",
        summary: "",
      },
    };
    expect(toolSummary(msg)).toBe("Called write_file");
  });

  it("returns fallback when summary is undefined", () => {
    const msg = {
      tool_interaction: {
        name: "search",
        summary: undefined as unknown as string,
      },
    };
    expect(toolSummary(msg)).toBe("Called search");
  });
});

// ---------- toolBadgeColors ----------

describe("toolBadgeColors", () => {
  it("defines colors for all supported tools", () => {
    expect(toolBadgeColors["claude-code"]).toBeDefined();
    expect(toolBadgeColors.cursor).toBeDefined();
    expect(toolBadgeColors.codex).toBeDefined();
    expect(toolBadgeColors.gemini).toBeDefined();
  });

  it("each entry has bg and text properties", () => {
    for (const [, value] of Object.entries(toolBadgeColors)) {
      expect(value).toHaveProperty("bg");
      expect(value).toHaveProperty("text");
    }
  });
});

// ---------- getToolBadge ----------

describe("getToolBadge", () => {
  it("returns correct colors for known tools", () => {
    expect(getToolBadge("claude-code")).toBe(toolBadgeColors["claude-code"]);
    expect(getToolBadge("cursor")).toBe(toolBadgeColors.cursor);
  });

  it("returns default badge for unknown tools", () => {
    expect(getToolBadge("unknown-tool")).toBe(defaultToolBadge);
  });

  it("returns default badge for null/undefined", () => {
    expect(getToolBadge(null)).toBe(defaultToolBadge);
    expect(getToolBadge(undefined)).toBe(defaultToolBadge);
  });
});

// ---------- getToolLabel ----------

describe("getToolLabel", () => {
  it("returns human-readable label for known tools", () => {
    expect(getToolLabel("claude-code")).toBe("Claude Code");
    expect(getToolLabel("cursor")).toBe("Cursor");
    expect(getToolLabel("codex")).toBe("Codex");
    expect(getToolLabel("gemini")).toBe("Gemini");
  });

  it("returns the raw string for unknown tools", () => {
    expect(getToolLabel("some-tool")).toBe("some-tool");
  });

  it("returns Unknown for null/undefined", () => {
    expect(getToolLabel(null)).toBe("Unknown");
    expect(getToolLabel(undefined)).toBe("Unknown");
  });
});
