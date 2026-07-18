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
    const loaded = store.load("claude-code", "ses_test1");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("ses_test1");
    expect(loaded?.messages).toHaveLength(1);
  });

  it("returns null for nonexistent session", () => {
    expect(store.load("claude-code", "ses_nonexistent")).toBeNull();
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
    const loaded = store.load("claude-code", "ses_1");
    expect(loaded?.messages).toHaveLength(2);
  });

  it("deletes a session", () => {
    store.save(makeSession({ id: "ses_del" }));
    expect(store.load("claude-code", "ses_del")).not.toBeNull();
    store.delete("claude-code", "ses_del");
    expect(store.load("claude-code", "ses_del")).toBeNull();
  });

  it("stores the same session ID independently for different tools", () => {
    store.save(makeSession({ id: "shared-id", tool: "claude-code" }));
    store.save(makeSession({ id: "shared-id", tool: "codex", messages: [] }));

    expect(store.load("claude-code", "shared-id")?.messages).toHaveLength(1);
    expect(store.load("codex", "shared-id")?.messages).toHaveLength(0);
    expect(store.list()).toHaveLength(2);

    store.delete("claude-code", "shared-id");
    expect(store.load("claude-code", "shared-id")).toBeNull();
    expect(store.load("codex", "shared-id")).not.toBeNull();
  });

  it("reads a legacy flat-file session and migrates it on the next save", () => {
    const legacy = makeSession({ id: "ses_legacy", tool: "cursor" });
    const legacyPath = path.join(tmpDir, "ses_legacy.json");
    fs.writeFileSync(legacyPath, JSON.stringify(legacy));

    expect(store.load("cursor", "ses_legacy")?.id).toBe("ses_legacy");
    expect(store.load("claude-code", "ses_legacy")).toBeNull();

    store.save(legacy);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(store.load("cursor", "ses_legacy")?.id).toBe("ses_legacy");
  });

  describe("default-dir resolution (Windows regression guard)", () => {
    // Bug class: the constructor used `process.env.HOME ?? "~"` as the fallback.
    // On Windows, HOME is undefined by default (Windows uses USERPROFILE), so
    // the fallback was a LITERAL `"~"` directory created in the current working
    // directory — not the user's home. This caused capture sessions to land in
    // a stray `./~/.synapse/sessions/` folder on Windows, which the reader
    // never looked in. Fixed by switching to `os.homedir()`.

    it("resolves the default sessions dir under os.homedir() (no literal '~' anywhere)", () => {
      // Construct WITHOUT explicit dir so the default-path branch runs.
      // Save state we'll restore so other tests aren't affected.
      const origCwd = process.cwd();
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-store-cwd-"));
      try {
        process.chdir(sandbox);
        const s = new SessionStore();
        // Save a session via the default-dir path so the constructor's
        // mkdirSync actually fires against the real resolved path.
        s.save(makeSession({ id: "ses_default_dir" }));

        // Regression guard 1: no literal `~` directory created in CWD.
        // (Pre-fix, `path.join("~", ".synapse", "sessions")` made one.)
        expect(fs.existsSync(path.join(sandbox, "~"))).toBe(false);

        // Regression guard 2: the file landed under os.homedir().
        // We don't assert the EXACT path (would clobber the user's real
        // ~/.synapse/sessions in dev) — instead we read it back and confirm
        // the load roundtrip works from the default location.
        const loaded = s.load("claude-code", "ses_default_dir");
        expect(loaded?.id).toBe("ses_default_dir");

        // Cleanup the test session from the real homedir so we don't leak.
        s.delete("claude-code", "ses_default_dir");
      } finally {
        process.chdir(origCwd);
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
    });
  });
});
