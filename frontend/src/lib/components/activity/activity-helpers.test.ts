import { describe, expect, it } from "vitest";
import { actionLabels, getActionLabel } from "./activity-helpers";

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
