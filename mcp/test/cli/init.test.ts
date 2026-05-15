import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";

let tmp: string;
let originalHome: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-init-");
  originalHome = process.env.HOME;
  process.env.HOME = tmp;
  process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalHome !== undefined) process.env.HOME = originalHome;
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("synapse init", () => {
  it("creates ~/.claude/settings.json with handoff hooks chained", async () => {
    await runInit({ api_key: "k", skip_service: true });
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf-8"));
    expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);
    expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("synapse");
  });

  it("preserves existing hooks (chains new ones, does not replace)", async () => {
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".claude/settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo existing" }] }] } }),
    );
    await runInit({ api_key: "k", skip_service: true });
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf-8"));
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("echo existing");
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("synapse");
  });

  it("installs slash command files in ~/.claude/commands/synapse/", async () => {
    await runInit({ api_key: "k", skip_service: true });
    const dir = path.join(tmp, ".claude/commands/synapse");
    expect(fs.existsSync(dir)).toBe(true);
    const files = fs.readdirSync(dir);
    expect(files).toContain("handoff.md");
    expect(files).toContain("focus.md");
    expect(files).toContain("issue.md");
    expect(files).toContain("status.md");
    expect(files).toContain("doctor.md");
    expect(files).toContain("invite.md");
  });

  it("slash command files are idempotent — re-running init doesn't duplicate", async () => {
    await runInit({ api_key: "k", skip_service: true });
    await runInit({ api_key: "k", skip_service: true });
    const dir = path.join(tmp, ".claude/commands/synapse");
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(6);
  });
});
