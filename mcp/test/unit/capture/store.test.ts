import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../../src/capture/store.js";
import type { CapturedSession } from "../../../src/capture/types.js";

function makeSession(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return {
    id: "ses_test1",
    tool: "claude-code",
    projectPath: "/tmp/test-project",
    startedAt: "2026-04-02T10:00:00Z",
    updatedAt: "2026-04-02T10:05:00Z",
    messages: [{ role: "user", content: "hello", timestamp: "2026-04-02T10:00:00Z" }],
    ...overrides,
  };
}

describe("SessionStore", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-store-test-"));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a session", () => {
    const session = makeSession();
    store.save(session);
    const loaded = store.load("ses_test1");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("ses_test1");
    expect(loaded?.messages).toHaveLength(1);
  });

  it("returns null for nonexistent session", () => {
    expect(store.load("ses_nonexistent")).toBeNull();
  });

  it("lists saved sessions sorted by updatedAt descending", () => {
    store.save(makeSession({ id: "ses_old", updatedAt: "2026-04-01T10:00:00Z" }));
    store.save(makeSession({ id: "ses_new", updatedAt: "2026-04-02T10:00:00Z" }));
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("ses_new");
    expect(list[1].id).toBe("ses_old");
  });

  it("overwrites an existing session on save", () => {
    store.save(
      makeSession({
        id: "ses_1",
        messages: [{ role: "user", content: "v1", timestamp: "2026-04-02T10:00:00Z" }],
      }),
    );
    store.save(
      makeSession({
        id: "ses_1",
        messages: [
          { role: "user", content: "v1", timestamp: "2026-04-02T10:00:00Z" },
          { role: "assistant", content: "v2", timestamp: "2026-04-02T10:00:01Z" },
        ],
      }),
    );
    const loaded = store.load("ses_1");
    expect(loaded?.messages).toHaveLength(2);
  });

  it("deletes a session", () => {
    store.save(makeSession({ id: "ses_del" }));
    expect(store.load("ses_del")).not.toBeNull();
    store.delete("ses_del");
    expect(store.load("ses_del")).toBeNull();
  });
});
