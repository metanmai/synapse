import { describe, expect, it } from "vitest";
import { type FeedEvent, actionLabels, buildFeedEvent, getActionLabel, groupByDay } from "./activity-helpers";

describe("actionLabels", () => {
  it("contains all expected activity actions", () => {
    const expectedActions = [
      "entry_created",
      "entry_updated",
      "entry_deleted",
      "member_added",
      "member_removed",
      "settings_changed",
      "share_link_created",
      "share_link_revoked",
    ];
    for (const action of expectedActions) {
      expect(actionLabels[action]).toBeDefined();
    }
  });

  it("maps entry_created to 'created'", () => {
    expect(actionLabels.entry_created).toBe("created");
  });

  it("maps entry_updated to 'updated'", () => {
    expect(actionLabels.entry_updated).toBe("updated");
  });

  it("maps entry_deleted to 'deleted'", () => {
    expect(actionLabels.entry_deleted).toBe("deleted");
  });

  it("maps member_added to 'added member'", () => {
    expect(actionLabels.member_added).toBe("added member");
  });

  it("maps share_link_created to 'created share link'", () => {
    expect(actionLabels.share_link_created).toBe("created share link");
  });

  it("maps share_link_revoked to 'revoked share link'", () => {
    expect(actionLabels.share_link_revoked).toBe("revoked share link");
  });
});

describe("getActionLabel", () => {
  it("returns the human-readable label for known actions", () => {
    expect(getActionLabel("entry_created")).toBe("created");
    expect(getActionLabel("member_removed")).toBe("removed member");
    expect(getActionLabel("settings_changed")).toBe("changed settings");
  });

  it("returns the raw action string for unknown actions", () => {
    expect(getActionLabel("custom_action")).toBe("custom_action");
    expect(getActionLabel("unknown")).toBe("unknown");
  });

  it("returns empty string as-is for empty input", () => {
    expect(getActionLabel("")).toBe("");
  });
});

describe("buildFeedEvent", () => {
  it("maps conversation_created to CAPTURED badge", () => {
    const event = buildFeedEvent({
      action: "conversation_created",
      source: "claude",
      target_path: null,
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.type).toBe("captured");
    expect(event.badge).toBe("CAPTURED");
    expect(event.badgeClass).toBe("badge-captured");
    expect(event.title).toBe("Session synced");
  });

  it("maps conversation_synced to CAPTURED badge", () => {
    const event = buildFeedEvent({
      action: "conversation_synced",
      source: "cursor",
      target_path: "auth refactor",
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.type).toBe("captured");
    expect(event.metadata).toContain("cursor");
  });

  it("maps distill source to DISTILLED badge", () => {
    const event = buildFeedEvent({
      action: "entry_created",
      source: "distill",
      target_path: "decisions/chose-redis.md",
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.type).toBe("distilled");
    expect(event.badge).toBe("DISTILLED");
    expect(event.files).toHaveLength(1);
    expect(event.files?.[0].path).toBe("decisions/chose-redis.md");
  });

  it("maps entry_created to UPDATED badge", () => {
    const event = buildFeedEvent({
      action: "entry_created",
      source: "claude",
      target_path: "notes/standup.md",
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.type).toBe("updated");
    expect(event.badge).toBe("UPDATED");
    expect(event.title).toBe("File created");
  });

  it("maps entry_updated to File updated title", () => {
    const event = buildFeedEvent({
      action: "entry_updated",
      source: "web",
      target_path: "architecture/auth.md",
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.title).toBe("File updated");
  });

  it("maps entry_deleted to File deleted title", () => {
    const event = buildFeedEvent({
      action: "entry_deleted",
      source: "web",
      target_path: "old-file.md",
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.title).toBe("File deleted");
  });

  it("handles null target_path gracefully", () => {
    const event = buildFeedEvent({
      action: "entry_updated",
      source: "claude",
      target_path: null,
      created_at: "2026-04-03T10:00:00Z",
    });
    expect(event.metadata).toBe("");
  });
});

describe("groupByDay", () => {
  it("groups events by date", () => {
    const events: FeedEvent[] = [
      {
        type: "updated",
        timestamp: "2026-04-03T10:00:00Z",
        title: "A",
        metadata: "",
        badge: "UPDATED",
        badgeClass: "badge-updated",
      },
      {
        type: "updated",
        timestamp: "2026-04-03T14:00:00Z",
        title: "B",
        metadata: "",
        badge: "UPDATED",
        badgeClass: "badge-updated",
      },
      {
        type: "updated",
        timestamp: "2026-04-02T10:00:00Z",
        title: "C",
        metadata: "",
        badge: "UPDATED",
        badgeClass: "badge-updated",
      },
    ];
    const groups = groupByDay(events);
    expect(groups.length).toBe(2);
    expect(groups[0].events).toHaveLength(2);
    expect(groups[1].events).toHaveLength(1);
  });

  it("returns empty array for no events", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
