import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSyncStates, saveSyncStates, syncStatePath } from "../../../src/capture/sync-state-store.js";

describe("sync-state-store", () => {
  const originalHome = process.env.SYNAPSE_HOME;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-state-test-"));
    process.env.SYNAPSE_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome) {
      process.env.SYNAPSE_HOME = originalHome;
    } else {
      process.env.SYNAPSE_HOME = undefined;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty Map when the file does not exist", () => {
    expect(loadSyncStates().size).toBe(0);
  });

  it("round-trips state via save/load", () => {
    const states = new Map([
      ["ses_a", { cloudConversationId: "conv_1", lastSyncedMessageCount: 10 }],
      ["ses_b", { cloudConversationId: "conv_2", lastSyncedMessageCount: 25 }],
    ]);
    saveSyncStates(states);
    const loaded = loadSyncStates();
    expect(loaded.size).toBe(2);
    expect(loaded.get("ses_a")).toEqual({ cloudConversationId: "conv_1", lastSyncedMessageCount: 10 });
    expect(loaded.get("ses_b")).toEqual({ cloudConversationId: "conv_2", lastSyncedMessageCount: 25 });
  });

  it("returns empty Map and logs when JSON is malformed (does not throw)", () => {
    fs.writeFileSync(syncStatePath(), "{ this is not valid");
    const logs: string[] = [];
    const loaded = loadSyncStates((m) => logs.push(m));
    expect(loaded.size).toBe(0);
    expect(logs.some((l) => l.includes("sync-state.json"))).toBe(true);
  });

  it("returns empty Map when version field doesn't match", () => {
    fs.writeFileSync(
      syncStatePath(),
      JSON.stringify({ version: 999, states: { ses_x: { cloudConversationId: "c", lastSyncedMessageCount: 0 } } }),
    );
    const logs: string[] = [];
    expect(loadSyncStates((m) => logs.push(m)).size).toBe(0);
    expect(logs.some((l) => l.includes("version"))).toBe(true);
  });

  it("filters out individual entries with wrong shape but keeps valid siblings", () => {
    fs.writeFileSync(
      syncStatePath(),
      JSON.stringify({
        version: 1,
        states: {
          good: { cloudConversationId: "conv_good", lastSyncedMessageCount: 5 },
          bad_no_id: { lastSyncedMessageCount: 5 },
          bad_wrong_type: { cloudConversationId: "conv_x", lastSyncedMessageCount: "not a number" },
        },
      }),
    );
    const loaded = loadSyncStates();
    expect(loaded.size).toBe(1);
    expect(loaded.get("good")?.cloudConversationId).toBe("conv_good");
  });

  it("writes via a .tmp + rename, so the real file is never half-written", () => {
    const states = new Map([["ses", { cloudConversationId: "c", lastSyncedMessageCount: 1 }]]);
    saveSyncStates(states);
    // After a successful save, the .tmp must be cleaned up.
    expect(fs.existsSync(`${syncStatePath()}.tmp`)).toBe(false);
    expect(fs.existsSync(syncStatePath())).toBe(true);
  });

  it("creates the synapse home dir if missing", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // tmpDir no longer exists; saveSyncStates must recreate the path.
    saveSyncStates(new Map([["ses", { cloudConversationId: "c", lastSyncedMessageCount: 1 }]]));
    expect(fs.existsSync(syncStatePath())).toBe(true);
  });
});
