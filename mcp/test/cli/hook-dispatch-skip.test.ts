import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shouldSkipDispatch } from "../../src/cli/hook-dispatch.js";

describe("shouldSkipDispatch", () => {
  let sandbox: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-skip-test-"));
    home = path.join(sandbox, "home");
    project = path.join(home, "work", "real-project");
    fs.mkdirSync(project, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  // ── (c) SYNAPSE_SKIP_DISPATCH env var ────────────────────────────────────

  it("skips when SYNAPSE_SKIP_DISPATCH=1", () => {
    const result = shouldSkipDispatch(project, { SYNAPSE_SKIP_DISPATCH: "1" }, { homeDir: home });
    expect(result.skip).toBe(true);
    if (result.skip) expect(result.reason).toContain("SYNAPSE_SKIP_DISPATCH=1");
  });

  it("does NOT skip when SYNAPSE_SKIP_DISPATCH=0", () => {
    const result = shouldSkipDispatch(project, { SYNAPSE_SKIP_DISPATCH: "0" }, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  it("does NOT skip when SYNAPSE_SKIP_DISPATCH is unset", () => {
    const result = shouldSkipDispatch(project, {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  // ── (a) ~/.claude/worktrees/ agent-isolation paths ────────────────────────

  it("skips when cwd is under ~/.claude/worktrees/", () => {
    const worktree = path.join(home, ".claude", "worktrees", "agent-abc123");
    const result = shouldSkipDispatch(worktree, {}, { homeDir: home });
    expect(result.skip).toBe(true);
    // path.join() produces "/" on POSIX, "\\" on Windows — matches whatever
    // path separator the source uses to build the reason string.
    if (result.skip) expect(result.reason).toContain(path.join(".claude", "worktrees"));
  });

  it("skips when cwd is a deeply-nested worktree subdir", () => {
    const deep = path.join(home, ".claude", "worktrees", "agent-x", "src", "lib");
    const result = shouldSkipDispatch(deep, {}, { homeDir: home });
    expect(result.skip).toBe(true);
  });

  it("does NOT skip ~/.claude/projects (only worktrees)", () => {
    const projects = path.join(home, ".claude", "projects", "foo");
    const result = shouldSkipDispatch(projects, {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  it("does NOT skip ~/.claude/worktrees-backup (boundary check)", () => {
    const lookalike = path.join(home, ".claude", "worktrees-backup", "foo");
    const result = shouldSkipDispatch(lookalike, {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  // ── (b) .synapse-skip marker file walk ────────────────────────────────────

  it("skips when .synapse-skip marker exists in cwd", () => {
    fs.writeFileSync(path.join(project, ".synapse-skip"), "");
    const result = shouldSkipDispatch(project, {}, { homeDir: home });
    expect(result.skip).toBe(true);
    if (result.skip) expect(result.reason).toContain(".synapse-skip");
  });

  it("skips when .synapse-skip marker exists in an ancestor", () => {
    fs.writeFileSync(path.join(home, "work", ".synapse-skip"), "");
    const result = shouldSkipDispatch(project, {}, { homeDir: home });
    expect(result.skip).toBe(true);
    if (result.skip) expect(result.reason).toContain(path.join(home, "work"));
  });

  it("skips when .synapse-skip marker exists at the home boundary itself", () => {
    fs.writeFileSync(path.join(home, ".synapse-skip"), "");
    const result = shouldSkipDispatch(project, {}, { homeDir: home });
    expect(result.skip).toBe(true);
  });

  it("does NOT walk above home (marker outside home is ignored)", () => {
    fs.writeFileSync(path.join(sandbox, ".synapse-skip"), "");
    const result = shouldSkipDispatch(project, {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  it("honors custom markerFile override", () => {
    fs.writeFileSync(path.join(project, ".no-capture"), "");
    const result = shouldSkipDispatch(project, {}, { homeDir: home, markerFile: ".no-capture" });
    expect(result.skip).toBe(true);
  });

  // ── No skip: legitimate project cwds ──────────────────────────────────────

  it("does NOT skip a normal cwd inside the user's home", () => {
    const result = shouldSkipDispatch(project, {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  it("does NOT skip the home directory itself (when no marker)", () => {
    const result = shouldSkipDispatch(home, {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  it("does NOT skip a /tmp cwd (/tmp dirs are legitimate projects)", () => {
    const result = shouldSkipDispatch("/tmp/some-project", {}, { homeDir: home });
    expect(result.skip).toBe(false);
  });

  // ── (e) SYNAPSE_DISPATCH_FORCE_ALLOW override ────────────────────────────

  it("force-allow env var wins over every other skip condition", () => {
    fs.writeFileSync(path.join(project, ".synapse-skip"), "");
    const worktree = path.join(home, ".claude", "worktrees", "agent-abc");
    const result = shouldSkipDispatch(
      worktree, // would trigger (a)
      {
        SYNAPSE_DISPATCH_FORCE_ALLOW: "1",
        SYNAPSE_SKIP_DISPATCH: "1", // would trigger (d)
      },
      { homeDir: home, tmpPrefixes: ["/var/folders"] }, // would trigger (b) for any /var/folders cwd
    );
    expect(result.skip).toBe(false);
  });

  it("force-allow with worktree cwd in tmpdir-prefix: allows", () => {
    // Realistic E2E test scenario: testDir under /var/folders, predicate
    // normally skips, force-allow lets capture fire.
    const result = shouldSkipDispatch(
      "/var/folders/_2/abc/T/synapse-e2e-12345",
      { SYNAPSE_DISPATCH_FORCE_ALLOW: "1" },
      { homeDir: home, tmpPrefixes: ["/var/folders"] },
    );
    expect(result.skip).toBe(false);
  });

  it("force-allow value other than '1' does NOT override", () => {
    const worktree = path.join(home, ".claude", "worktrees", "agent-abc");
    const result = shouldSkipDispatch(
      worktree,
      { SYNAPSE_DISPATCH_FORCE_ALLOW: "0" },
      { homeDir: home, tmpPrefixes: [] },
    );
    expect(result.skip).toBe(true);
    // path.join() produces "/" on POSIX, "\\" on Windows — matches whatever
    // path separator the source uses to build the reason string.
    if (result.skip) expect(result.reason).toContain(path.join(".claude", "worktrees"));
  });

  // ── Combinations: env beats everything (short-circuit) ────────────────────

  it("env-var wins over worktree path (short-circuits)", () => {
    const worktree = path.join(home, ".claude", "worktrees", "agent-abc");
    const result = shouldSkipDispatch(worktree, { SYNAPSE_SKIP_DISPATCH: "1" }, { homeDir: home });
    expect(result.skip).toBe(true);
    if (result.skip) expect(result.reason).toContain("SYNAPSE_SKIP_DISPATCH=1");
  });

  // ── Defense: fileExists DI ────────────────────────────────────────────────

  it("uses the fileExists DI hook for marker walk", () => {
    const seen: string[] = [];
    const result = shouldSkipDispatch(
      project,
      {},
      {
        homeDir: home,
        fileExists: (p) => {
          seen.push(p);
          return false;
        },
      },
    );
    expect(result.skip).toBe(false);
    expect(seen).toContain(path.join(project, ".synapse-skip"));
    expect(seen).toContain(path.join(home, "work", ".synapse-skip"));
    expect(seen).toContain(path.join(home, ".synapse-skip"));
  });
});
