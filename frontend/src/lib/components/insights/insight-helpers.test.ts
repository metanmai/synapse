import { describe, expect, it } from "vitest";
import {
  badgeColors,
  formatInsightDate,
  formatInsightType,
  getBadgeColor,
  groupInsightsByType,
} from "./insight-helpers";

// ---------- badgeColors ----------

describe("badgeColors", () => {
  it("defines colors for all insight types", () => {
    const expectedTypes = ["decision", "learning", "preference", "architecture", "action_item"];
    for (const type of expectedTypes) {
      expect(badgeColors[type]).toBeDefined();
      expect(badgeColors[type]).toHaveProperty("bg");
      expect(badgeColors[type]).toHaveProperty("text");
    }
  });

  it("decision type uses blue", () => {
    expect(badgeColors.decision.text).toBe("#2563eb");
  });

  it("learning type uses green", () => {
    expect(badgeColors.learning.text).toBe("#16a34a");
  });

  it("preference type uses purple", () => {
    expect(badgeColors.preference.text).toBe("#9333ea");
  });

  it("architecture type uses orange", () => {
    expect(badgeColors.architecture.text).toBe("#ea580c");
  });

  it("action_item type uses red", () => {
    expect(badgeColors.action_item.text).toBe("#dc2626");
  });
});

// ---------- getBadgeColor ----------

describe("getBadgeColor", () => {
  it("returns the correct color for known insight types", () => {
    expect(getBadgeColor("decision")).toEqual(badgeColors.decision);
    expect(getBadgeColor("learning")).toEqual(badgeColors.learning);
    expect(getBadgeColor("action_item")).toEqual(badgeColors.action_item);
  });

  it("returns default fallback for unknown types", () => {
    const fallback = getBadgeColor("unknown_type");
    expect(fallback).toEqual({ bg: "rgba(0,0,0,0.08)", text: "inherit" });
  });

  it("returns default fallback for empty string", () => {
    const fallback = getBadgeColor("");
    expect(fallback).toEqual({ bg: "rgba(0,0,0,0.08)", text: "inherit" });
  });
});

// ---------- formatInsightDate ----------

describe("formatInsightDate", () => {
  it("formats ISO date to US locale short date", () => {
    const result = formatInsightDate("2026-03-28T12:00:00Z");
    // Should contain "Mar 28, 2026" or equivalent locale format
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/28/);
    expect(result).toMatch(/2026/);
  });

  it("handles dates from different months", () => {
    const result = formatInsightDate("2025-12-01T00:00:00Z");
    expect(result).toMatch(/Dec/);
    expect(result).toMatch(/2025/);
  });

  it("is deterministic for the same input", () => {
    const iso = "2026-06-15T10:30:00Z";
    expect(formatInsightDate(iso)).toBe(formatInsightDate(iso));
  });
});

// ---------- formatInsightType ----------

describe("formatInsightType", () => {
  it("replaces underscore with space", () => {
    expect(formatInsightType("action_item")).toBe("action item");
  });

  it("returns types without underscores unchanged", () => {
    expect(formatInsightType("decision")).toBe("decision");
    expect(formatInsightType("learning")).toBe("learning");
    expect(formatInsightType("preference")).toBe("preference");
    expect(formatInsightType("architecture")).toBe("architecture");
  });

  it("only replaces the first underscore", () => {
    // String.replace with a string only replaces the first occurrence
    expect(formatInsightType("multi_word_type")).toBe("multi word_type");
  });

  it("handles empty string", () => {
    expect(formatInsightType("")).toBe("");
  });
});

// ---------- groupInsightsByType ----------

describe("groupInsightsByType", () => {
  const makeInsight = (type: string, id: string) => ({
    id,
    type,
    summary: `${type} summary`,
    detail: null,
    source: { type: "session" as const, agent: "test" },
    updated_at: "2026-04-03T10:00:00Z",
    created_at: "2026-04-03T10:00:00Z",
  });

  it("groups insights by type with correct labels", () => {
    const insights = [
      makeInsight("decision", "1"),
      makeInsight("decision", "2"),
      makeInsight("learning", "3"),
      makeInsight("architecture", "4"),
    ];
    const groups = groupInsightsByType(insights);
    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("decision");
    expect(groups[0].label).toBe("Decisions");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].type).toBe("architecture");
    expect(groups[1].label).toBe("Architecture");
    expect(groups[1].items).toHaveLength(1);
    expect(groups[2].type).toBe("learning");
    expect(groups[2].label).toBe("Learnings");
    expect(groups[2].items).toHaveLength(1);
  });

  it("omits empty groups", () => {
    const insights = [makeInsight("decision", "1")];
    const groups = groupInsightsByType(insights);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("decision");
  });

  it("returns empty array for no insights", () => {
    expect(groupInsightsByType([])).toEqual([]);
  });

  it("preserves type order: decision, architecture, learning, preference, action_item", () => {
    const insights = [
      makeInsight("action_item", "1"),
      makeInsight("decision", "2"),
      makeInsight("learning", "3"),
      makeInsight("preference", "4"),
      makeInsight("architecture", "5"),
    ];
    const groups = groupInsightsByType(insights);
    expect(groups.map((g) => g.type)).toEqual(["decision", "architecture", "learning", "preference", "action_item"]);
  });
});
