import { describe, expect, it } from "vitest";
import { formatBrief, formatWorkspaceBrief } from "../../src/cli/brief-format.js";

describe("formatBrief", () => {
  const baseData = {
    project: { name: "synapse" },
    summary: "We're rebuilding auth middleware.",
    summary_updated_at: "2026-04-13T10:00:00Z",
    recent_conversations: [
      {
        id: "ses_a",
        title: "Fix auth race",
        compacted_summary: "Identified and patched.",
        compacted_at: "2026-04-13T09:00:00Z",
      },
    ],
    insights: [
      {
        type: "decision" as const,
        summary: "Use Postgres",
        detail: null,
        updated_at: "2026-04-13T08:00:00Z",
      },
    ],
    now: new Date("2026-04-13T11:00:00Z"),
  };

  it("wraps output in <synapse-brief> tags", () => {
    const out = formatBrief(baseData);
    expect(out).toContain("<synapse-brief>");
    expect(out).toContain("</synapse-brief>");
  });

  it("includes project name and summary", () => {
    const out = formatBrief(baseData);
    expect(out).toContain("Project: synapse");
    expect(out).toContain("rebuilding auth middleware");
  });

  it("lists recent insights with type prefix", () => {
    const out = formatBrief(baseData);
    expect(out).toMatch(/\[decision/);
    expect(out).toContain("Use Postgres");
  });

  it("handles missing summary gracefully", () => {
    const out = formatBrief({ ...baseData, summary: null });
    expect(out).toContain("No project summary yet");
  });

  it("handles empty insights + conversations", () => {
    const out = formatBrief({ ...baseData, insights: [], recent_conversations: [] });
    expect(out).toContain("<synapse-brief>");
    expect(out).toContain("Project: synapse");
  });
});

describe("formatWorkspaceBrief", () => {
  it("shows top-5 projects when no project matched cwd", () => {
    const out = formatWorkspaceBrief({
      projects: [
        { id: "1", name: "synapse", updated_at: "2026-04-13T10:00:00Z" },
        { id: "2", name: "workpulse", updated_at: "2026-04-12T10:00:00Z" },
      ],
      now: new Date("2026-04-13T11:00:00Z"),
    });
    expect(out).toContain("<synapse-brief>");
    expect(out).toContain("No project matched this location");
    expect(out).toContain("synapse");
    expect(out).toContain("workpulse");
  });

  it("handles empty workspace gracefully", () => {
    const out = formatWorkspaceBrief({ projects: [], now: new Date() });
    expect(out).toContain("Welcome to Synapse");
    expect(out).toContain("<synapse-brief>");
  });
});
