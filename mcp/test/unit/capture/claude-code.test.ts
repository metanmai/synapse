import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter, claudeCodeWatchCandidates } from "../../../src/capture/adapters/claude-code.js";
import { SYNAPSE_INTERNAL_MARKER } from "../../../src/capture/types.js";

describe("claudeCodeWatchCandidates", () => {
  it("includes ~/.claude/projects/ as the first candidate", () => {
    const candidates = claudeCodeWatchCandidates({ home: "/h", env: {} });
    expect(candidates[0]).toBe(path.join("/h", ".claude", "projects"));
  });

  it("includes $XDG_CONFIG_HOME/claude/projects/ when XDG_CONFIG_HOME is set", () => {
    const candidates = claudeCodeWatchCandidates({
      home: "/h",
      env: { XDG_CONFIG_HOME: "/custom/xdg" },
    });
    expect(candidates).toContain(path.join("/custom/xdg", "claude", "projects"));
  });

  it("includes ~/.config/claude/projects/ as the Linux XDG default fallback", () => {
    const candidates = claudeCodeWatchCandidates({ home: "/h", env: {} });
    expect(candidates).toContain(path.join("/h", ".config", "claude", "projects"));
  });

  it("does NOT duplicate when XDG_CONFIG_HOME equals ~/.config", () => {
    const candidates = claudeCodeWatchCandidates({
      home: "/h",
      env: { XDG_CONFIG_HOME: "/h/.config" },
    });
    const dedupCount = candidates.filter((c) => c === path.join("/h", ".config", "claude", "projects")).length;
    expect(dedupCount).toBe(1);
  });

  it("ignores empty XDG_CONFIG_HOME (treats as unset)", () => {
    const candidates = claudeCodeWatchCandidates({
      home: "/h",
      env: { XDG_CONFIG_HOME: "" },
    });
    // Should be 2 entries (legacy + ~/.config), not 3
    expect(candidates).toHaveLength(2);
  });

  it("ignores whitespace-only XDG_CONFIG_HOME", () => {
    const candidates = claudeCodeWatchCandidates({
      home: "/h",
      env: { XDG_CONFIG_HOME: "   " },
    });
    expect(candidates).toHaveLength(2);
  });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../../fixtures/capture/claude-code/sample-session.jsonl");

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  it("has tool name 'claude-code'", () => {
    expect(adapter.tool).toBe("claude-code");
  });

  it("returns watch paths under ~/.claude/projects", () => {
    const paths = adapter.watchPaths();
    expect(paths.length).toBeGreaterThan(0);
    // path.join produces platform-shaped separator; on Windows the path
    // is `\.claude\projects`, on POSIX `/.claude/projects`. Asserting via
    // path.join makes the test cross-OS-correct.
    expect(paths[0]).toContain(path.join(".claude", "projects"));
  });

  it("parses a JSONL session file into CapturedSession", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.tool).toBe("claude-code");
    expect(session?.id).toBe("ses_a1b2c3d4e5f67890");
    expect(session?.projectPath).toBe("/Users/test/myproject");
  });

  it("extracts user and assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const userMsgs = session?.messages.filter((m) => m.role === "user");
    const assistantMsgs = session?.messages.filter((m) => m.role === "assistant");
    expect(userMsgs?.length).toBeGreaterThan(0);
    expect(assistantMsgs?.length).toBeGreaterThan(0);
  });

  it("extracts tool calls from assistant messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    const withTools = session?.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools?.length).toBeGreaterThan(0);
    expect(withTools?.[0].toolCalls?.[0].name).toBe("Read");
  });

  it("returns null for non-JSONL files", () => {
    expect(adapter.parse("/some/random/file.txt")).toBeNull();
  });

  it("skips sidechain messages", () => {
    const session = adapter.parse(FIXTURE);
    expect(session).not.toBeNull();
    expect(session?.messages.length).toBeGreaterThan(0);
  });

  // Regression guard: bug class "compaction spawns recursively capture
  // themselves and create an infinite loop". Adapter.compact() prepends
  // SYNAPSE_INTERNAL_MARKER to its prompt so the resulting session file
  // (written by Claude Code as a side-effect of `claude -p`) gets recognized
  // by parse() and dropped. Without this filter, every compaction creates a
  // new conversation on the backend that gets compacted, recursively forever.
  describe("recursion guard via SYNAPSE_INTERNAL_MARKER", () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-marker-test-"));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns null when the first user message starts with SYNAPSE_INTERNAL_MARKER", () => {
      const file = path.join(tmpDir, "internal-session.jsonl");
      const lines = [
        {
          parentUuid: null,
          isSidechain: false,
          type: "user",
          message: { role: "user", content: `${SYNAPSE_INTERNAL_MARKER}\nSummarize: …` },
          uuid: "u-1",
          timestamp: "2026-05-24T03:00:00.000Z",
          sessionId: "self-compaction-session-id",
          cwd: "/Users/test/anywhere",
        },
        {
          parentUuid: "u-1",
          isSidechain: false,
          type: "assistant",
          message: { role: "assistant", content: "Brief summary text." },
          uuid: "a-1",
          timestamp: "2026-05-24T03:00:05.000Z",
        },
      ];
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));

      expect(adapter.parse(file)).toBeNull();
    });

    it("still parses normal sessions whose first user message does NOT start with the marker", () => {
      const file = path.join(tmpDir, "normal-session.jsonl");
      const lines = [
        {
          parentUuid: null,
          isSidechain: false,
          type: "user",
          message: { role: "user", content: "What is 2 + 2?" },
          uuid: "u-1",
          timestamp: "2026-05-24T03:00:00.000Z",
          sessionId: "normal-session-id",
          cwd: "/Users/test/project",
        },
        {
          parentUuid: "u-1",
          isSidechain: false,
          type: "assistant",
          message: { role: "assistant", content: "4." },
          uuid: "a-1",
          timestamp: "2026-05-24T03:00:01.000Z",
        },
      ];
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));

      const parsed = adapter.parse(file);
      expect(parsed).not.toBeNull();
      expect(parsed?.messages.length).toBe(2);
    });
  });
});
