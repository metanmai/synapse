import { describe, expect, it } from "vitest";
import {
  agentColors,
  defaultToolBadge,
  formatMessageTime,
  formatRelativeDate,
  getAgentColor,
  getToolBadge,
  getToolLabel,
  pluralizeMessages,
  roleLabels,
  statusColors,
  toolBadgeColors,
  toolSummary,
} from "./conversation-helpers";

// ---------- statusColors ----------

describe("statusColors", () => {
  it("defines colors for active, archived, and deleted statuses", () => {
    expect(statusColors.active).toBeDefined();
    expect(statusColors.archived).toBeDefined();
    expect(statusColors.deleted).toBeDefined();
  });

  it("each entry has bg and text properties", () => {
    for (const [, value] of Object.entries(statusColors)) {
      expect(value).toHaveProperty("bg");
      expect(value).toHaveProperty("text");
      expect(typeof value.bg).toBe("string");
      expect(typeof value.text).toBe("string");
    }
  });

  it("active status uses green color", () => {
    expect(statusColors.active.text).toBe("#16a34a");
  });

  it("deleted status uses red color", () => {
    expect(statusColors.deleted.text).toBe("#dc2626");
  });
});

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

// ---------- agentColors ----------

describe("agentColors", () => {
  it("maps claude-code to orange", () => {
    expect(agentColors["claude-code"]).toBe("#ea580c");
  });

  it("maps chatgpt to green", () => {
    expect(agentColors.chatgpt).toBe("#16a34a");
  });

  it("maps gemini to blue", () => {
    expect(agentColors.gemini).toBe("#2563eb");
  });
});

// ---------- getAgentColor ----------

describe("getAgentColor", () => {
  it("returns orange for claude-code agent", () => {
    expect(getAgentColor("claude-code")).toBe("#ea580c");
  });

  it("returns orange for Claude (case-insensitive)", () => {
    expect(getAgentColor("Claude")).toBe("#ea580c");
  });

  it("returns green for ChatGPT (case-insensitive)", () => {
    expect(getAgentColor("ChatGPT")).toBe("#16a34a");
  });

  it("returns green for agent names containing gpt", () => {
    expect(getAgentColor("gpt-4o")).toBe("#16a34a");
  });

  it("returns blue for Gemini", () => {
    expect(getAgentColor("Gemini Pro")).toBe("#2563eb");
  });

  it("returns default gray for unknown agents", () => {
    expect(getAgentColor("unknown-agent")).toBe("#6b7280");
  });

  it("returns default gray for empty string", () => {
    expect(getAgentColor("")).toBe("#6b7280");
  });

  it("matches claude-code before claude (more specific first)", () => {
    // "claude-code" includes "claude", but the map iterates in insertion order
    // and "claude-code" is listed first
    expect(getAgentColor("claude-code")).toBe("#ea580c");
  });
});

// ---------- roleLabels ----------

describe("roleLabels", () => {
  it("defines labels for user, assistant, system, and tool", () => {
    expect(roleLabels.user).toBeDefined();
    expect(roleLabels.assistant).toBeDefined();
    expect(roleLabels.system).toBeDefined();
    expect(roleLabels.tool).toBeDefined();
  });

  it("user role has label 'User'", () => {
    expect(roleLabels.user.label).toBe("User");
  });

  it("assistant role has label 'Assistant'", () => {
    expect(roleLabels.assistant.label).toBe("Assistant");
  });

  it("tool role uses purple color", () => {
    expect(roleLabels.tool.color).toBe("#9333ea");
  });

  it("each role has label and color", () => {
    for (const [, value] of Object.entries(roleLabels)) {
      expect(typeof value.label).toBe("string");
      expect(typeof value.color).toBe("string");
    }
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

// ---------- pluralizeMessages ----------

describe("pluralizeMessages", () => {
  it("uses singular for count of 1", () => {
    expect(pluralizeMessages(1)).toBe("1 message");
  });

  it("uses plural for count of 0", () => {
    expect(pluralizeMessages(0)).toBe("0 messages");
  });

  it("uses plural for count > 1", () => {
    expect(pluralizeMessages(5)).toBe("5 messages");
    expect(pluralizeMessages(100)).toBe("100 messages");
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
