// mcp/test/unit/capture/cursor.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorAdapter, cursorWorkspaceStorageDir } from "../../../src/capture/adapters/cursor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/cursor/sample-chat.json");

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  it("has tool name 'cursor'", () => {
    expect(adapter.tool).toBe("cursor");
  });

  it("returns watch paths under Cursor workspace storage", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain("Cursor");
  });

  it("honors SYNAPSE_TEST_CURSOR_PATH override (test-affordance for E2E adapter-roundtrip)", () => {
    const prev = process.env.SYNAPSE_TEST_CURSOR_PATH;
    process.env.SYNAPSE_TEST_CURSOR_PATH = "/tmp/synapse-test-cursor-watch";
    try {
      expect(adapter.watchPaths()).toEqual(["/tmp/synapse-test-cursor-watch"]);
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: assigning undefined to process.env.X coerces to string "undefined" (truthy), which would leak the override into other tests
        delete process.env.SYNAPSE_TEST_CURSOR_PATH;
      } else {
        process.env.SYNAPSE_TEST_CURSOR_PATH = prev;
      }
    }
  });

  it("parses a JSON chat file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("cursor");
    expect(session?.id).toBe("ses_b2c3d4e5f6a78901");
  });

  it("extracts alternating user/assistant messages from requests", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.messages).toHaveLength(4); // 2 user + 2 assistant
    expect(session?.messages[0].role).toBe("user");
    expect(session?.messages[1].role).toBe("assistant");
    expect(session?.messages[2].role).toBe("user");
    expect(session?.messages[3].role).toBe("assistant");
  });

  it("returns null for non-JSON files", () => {
    expect(adapter.parse("/some/file.txt")).toBeNull();
  });
});

// Bug class: "the adapter's watchPaths() returns a path that doesn't
// match the actual location Cursor stores chat data on this OS, so
// chokidar watches nothing and we silently fail to capture any chats."
//
// Pre-fix: cursor.ts hardcoded the macOS "Library/Application Support"
// path with NO branching for win32/linux. On Windows + Linux the adapter
// resolved a path that doesn't exist on disk (~/Library on Windows = no
// such directory), so the daemon would watch a never-existing dir and
// capture zero chats. Now branches by process.platform.
describe("cursorWorkspaceStorageDir() per-platform paths", () => {
  it("darwin → ~/Library/Application Support/Cursor/User/workspaceStorage", () => {
    const p = cursorWorkspaceStorageDir("darwin");
    expect(p).toContain("Library/Application Support/Cursor/User/workspaceStorage");
    expect(p).not.toContain(".config");
    expect(p).not.toContain("AppData");
  });

  it("win32 → %APPDATA%\\Cursor\\User\\workspaceStorage (or ~/AppData/Roaming/Cursor/...)", () => {
    const prev = process.env.APPDATA;
    // biome-ignore lint/performance/noDelete: see test #2 in this file — `process.env.X = undefined` coerces to string "undefined" (truthy), poisoning subsequent tests
    delete process.env.APPDATA;
    try {
      const p = cursorWorkspaceStorageDir("win32");
      // Should land under AppData\Roaming (the standard Windows location)
      // since APPDATA env wasn't set in this test.
      expect(p).toMatch(/AppData[\\/]Roaming[\\/]Cursor[\\/]User[\\/]workspaceStorage/);
      // Must NOT have the macOS path.
      expect(p).not.toContain("Library/Application Support");
      // Must NOT have the Linux XDG path.
      expect(p).not.toContain(".config");
    } finally {
      if (prev !== undefined) process.env.APPDATA = prev;
    }
  });

  it("win32 with APPDATA env set → uses APPDATA value", () => {
    const prev = process.env.APPDATA;
    process.env.APPDATA = "D:\\Users\\customappdata";
    try {
      const p = cursorWorkspaceStorageDir("win32");
      expect(p.startsWith("D:\\Users\\customappdata")).toBe(true);
      expect(p).toContain("Cursor");
      expect(p).toContain("workspaceStorage");
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: see other override-cleanup blocks in this file
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = prev;
      }
    }
  });

  it("linux → ~/.config/Cursor/User/workspaceStorage (XDG layout)", () => {
    const p = cursorWorkspaceStorageDir("linux");
    expect(p).toContain(".config/Cursor/User/workspaceStorage");
    expect(p).not.toContain("Library/Application Support");
    expect(p).not.toContain("AppData");
  });

  it("freebsd → falls through to Linux/XDG layout (sensible default)", () => {
    const p = cursorWorkspaceStorageDir("freebsd");
    expect(p).toContain(".config/Cursor/User/workspaceStorage");
  });
});
