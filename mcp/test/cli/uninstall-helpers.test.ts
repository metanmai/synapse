/**
 * Unit tests for the helpers used by `synapse uninstall`.
 *
 * Covers:
 * - `isSynapseHookCommand` — detects both v1.0 (bare `synapse hook X`) and
 *   v1.1 (absolute-path `"<node>" "<index.js>" hook X`) hook command shapes,
 *   without producing false positives on unrelated hooks (GSD's
 *   `gsd-prompt-guard.js`, generic shell commands, etc.).
 * - `removeSynapseHooksFromClaudeSettings` — strips Synapse hook blocks from
 *   `~/.claude/settings.json` while preserving every other tool's blocks and
 *   the rest of the JSON shape.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isSynapseHookCommand, removeSynapseHooksFromClaudeSettings } from "../../src/cli/commands.js";

const ABS_HOOK = '"/opt/homebrew/Cellar/node/26.0.0/bin/node" "/Users/x/synapse/mcp/dist/index.js"';

describe("isSynapseHookCommand", () => {
  it("matches the v1.0 bare-`synapse` format for all 6 events", () => {
    for (const sub of [
      "session-start",
      "user-prompt-submit",
      "post-tool-use",
      "pre-compact",
      "session-end",
      "subagent-stop",
    ]) {
      expect(isSynapseHookCommand(`synapse hook ${sub}`)).toBe(true);
    }
  });

  it("matches the v1.1 absolute-path format for all 6 events", () => {
    for (const sub of [
      "session-start",
      "user-prompt-submit",
      "post-tool-use",
      "pre-compact",
      "session-end",
      "subagent-stop",
    ]) {
      expect(isSynapseHookCommand(`${ABS_HOOK} hook ${sub}`)).toBe(true);
    }
  });

  it("does NOT match unrelated hooks (GSD, generic shell commands)", () => {
    expect(isSynapseHookCommand('"/opt/homebrew/bin/node" "/Users/x/.claude/hooks/gsd-prompt-guard.js"')).toBe(false);
    expect(isSynapseHookCommand("echo hello")).toBe(false);
    expect(isSynapseHookCommand("synapse handoff foo")).toBe(false);
    expect(isSynapseHookCommand("hook session-start")).toBe(false); // missing the leading space
  });

  it("does NOT match unknown hook subcommands", () => {
    expect(isSynapseHookCommand("synapse hook unknown-event")).toBe(false);
  });

  it("handles undefined/non-string input safely", () => {
    expect(isSynapseHookCommand(undefined)).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard against non-string callers
    expect(isSynapseHookCommand(123 as any)).toBe(false);
  });
});

describe("removeSynapseHooksFromClaudeSettings", () => {
  let tmp: string;
  let settingsPath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync("/tmp/syn-uninstall-test-");
    settingsPath = path.join(tmp, "settings.json");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeSettings(obj: unknown): void {
    fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2));
  }

  function readSettings(): { hooks?: Record<string, unknown[]> } {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }

  it("strips v1.1 absolute-path Synapse hooks while keeping other tools' hooks", () => {
    writeSettings({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: `${ABS_HOOK} hook session-start` }] },
          { hooks: [{ type: "command", command: '"/usr/bin/node" "/x/gsd-check-update.js"' }] },
        ],
        PostToolUse: [
          {
            matcher: "Bash|Edit|Write",
            hooks: [{ type: "command", command: `${ABS_HOOK} hook post-tool-use` }],
          },
        ],
      },
    });
    expect(removeSynapseHooksFromClaudeSettings(settingsPath)).toBe(true);
    const after = readSettings();
    // SessionStart should keep the GSD hook, drop the Synapse one
    expect(after.hooks?.SessionStart).toHaveLength(1);
    // PostToolUse was Synapse-only — entire event key gone
    expect(after.hooks?.PostToolUse).toBeUndefined();
  });

  it("strips v1.0 bare-`synapse` hook format too (migration from older installs)", () => {
    writeSettings({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "synapse hook session-start" }] }],
      },
    });
    expect(removeSynapseHooksFromClaudeSettings(settingsPath)).toBe(true);
    const after = readSettings();
    expect(after.hooks).toBeUndefined();
  });

  it("returns false (and does not modify) when no Synapse hooks are present", () => {
    const original = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
      },
    };
    writeSettings(original);
    expect(removeSynapseHooksFromClaudeSettings(settingsPath)).toBe(false);
    expect(readSettings()).toEqual(original);
  });

  it("preserves non-hooks settings keys (other Claude Code config)", () => {
    writeSettings({
      apiKey: "sk-something",
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `${ABS_HOOK} hook session-start` }] }],
      },
    });
    expect(removeSynapseHooksFromClaudeSettings(settingsPath)).toBe(true);
    const after = readSettings() as Record<string, unknown>;
    expect(after.apiKey).toBe("sk-something");
    expect(after.hooks).toBeUndefined();
  });

  it("returns false gracefully when the settings file is malformed JSON", () => {
    fs.writeFileSync(settingsPath, "{ this is not json");
    expect(removeSynapseHooksFromClaudeSettings(settingsPath)).toBe(false);
  });
});
