import { describe, expect, it } from "vitest";
import { resolveStableNodePath } from "../../src/cli/util/node-path.js";

// Bug class under guard (2026-06-10): the installer persisted
// process.execPath verbatim into hooks / service units / .mcp.json. On
// Homebrew that path is version-pinned (/opt/homebrew/Cellar/node/<v>/bin/
// node) and vanishes on `brew upgrade node`, killing every hook and leaving
// the daemon un-respawnable after the next restart. These tests pin the
// rewrite-to-stable-alias behavior WITHOUT touching the real filesystem —
// existence checks are injected.

const CELLAR_ARM = "/opt/homebrew/Cellar/node/26.0.0/bin/node";

describe("resolveStableNodePath", () => {
  it("rewrites an arm64 Homebrew Cellar path to the formula opt symlink when it exists", () => {
    const exists = (p: string) => p === "/opt/homebrew/opt/node/bin/node";
    expect(resolveStableNodePath(CELLAR_ARM, exists)).toBe("/opt/homebrew/opt/node/bin/node");
  });

  it("falls back to the prefix bin symlink when the opt symlink is missing", () => {
    const exists = (p: string) => p === "/opt/homebrew/bin/node";
    expect(resolveStableNodePath(CELLAR_ARM, exists)).toBe("/opt/homebrew/bin/node");
  });

  it("prefers opt over bin when both exist (opt tracks the exact formula)", () => {
    const exists = () => true;
    expect(resolveStableNodePath(CELLAR_ARM, exists)).toBe("/opt/homebrew/opt/node/bin/node");
  });

  it("returns the raw path when no stable candidate exists — pinned-but-working beats stable-but-missing", () => {
    const exists = () => false;
    expect(resolveStableNodePath(CELLAR_ARM, exists)).toBe(CELLAR_ARM);
  });

  it("rewrites Intel-mac /usr/local Cellar paths to /usr/local opt", () => {
    const exists = (p: string) => p === "/usr/local/opt/node/bin/node";
    expect(resolveStableNodePath("/usr/local/Cellar/node/26.0.0/bin/node", exists)).toBe(
      "/usr/local/opt/node/bin/node",
    );
  });

  it("tracks versioned formulae (node@22) to their own opt symlink, not the global bin", () => {
    const exists = (p: string) => p.startsWith("/opt/homebrew/opt/node@22/");
    expect(resolveStableNodePath("/opt/homebrew/Cellar/node@22/22.14.0/bin/node", exists)).toBe(
      "/opt/homebrew/opt/node@22/bin/node",
    );
  });

  it.each([
    "/usr/bin/node",
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    `${"/home/user"}/.nvm/versions/node/v22.1.0/bin/node`,
    "C:\\Program Files\\nodejs\\node.exe",
    "/opt/homebrew/Cellar/deno/2.0.0/bin/deno",
  ])("passes through non-Cellar-node paths untouched: %s", (p) => {
    // exists=true everywhere proves passthrough is from non-recognition,
    // not from missing candidates.
    expect(resolveStableNodePath(p, () => true)).toBe(p);
  });

  it("is callable with no arguments and returns an absolute path", () => {
    const resolved = resolveStableNodePath();
    expect(resolved.startsWith("/") || /^[A-Za-z]:[\\/]/.test(resolved)).toBe(true);
  });
});
