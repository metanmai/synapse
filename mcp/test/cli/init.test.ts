import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as editorIo from "../../src/cli/editors/io.js";
import { runInit } from "../../src/cli/init.js";

let tmp: string;
let originalHome: string | undefined;
let originalCwd: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-init-");
  originalHome = process.env.HOME;
  originalCwd = process.cwd();
  process.env.HOME = tmp;
  process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
  // Plan 01-04: runInit now writes `.mcp.json` and `.gitignore` to
  // process.cwd(). Isolate every test in the tmpdir so those files don't
  // leak into the mcp/ workspace.
  process.chdir(tmp);
});
afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalHome !== undefined) process.env.HOME = originalHome;
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
  vi.restoreAllMocks();
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

// VALIDATION row mapping (01-VALIDATION.md "Per-Task Verification Map"):
//   BUG-04 → "writes a new .mcp.json in cwd with the synapse server entry"
//   BUG-04 → "merges into an existing .mcp.json preserving other server entries"
//   BUG-04 → "backs up and rewrites an invalid existing .mcp.json"
//   BUG-04 → "calls ensureGitignore(cwd, '.mcp.json') whenever cwd .mcp.json is written"
//
// All 4 cases below are RED until Plan 01-04 (Wave 3) wires `runInit` to call
// `writeMcpJson(path.join(process.cwd(), ".mcp.json"), api_key)` and
// `ensureGitignore(process.cwd(), ".mcp.json")` between writeConfig and
// writeServiceFile (per RESEARCH §"Code Examples" / `mcp/src/cli/editors/detect.ts`).

describe("synapse init — BUG-04 cwd .mcp.json", () => {
  it("writes a new .mcp.json in cwd with the synapse server entry", async () => {
    process.chdir(tmp);

    await runInit({ api_key: "sk-test", skip_service: true });

    const mcpPath = path.join(tmp, ".mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.synapse).toBeDefined();
    expect(content.mcpServers.synapse.env.SYNAPSE_API_KEY).toBe("sk-test");
  });

  it("merges into an existing .mcp.json preserving other server entries", async () => {
    process.chdir(tmp);
    const mcpPath = path.join(tmp, ".mcp.json");
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: { cursor: { command: "x" } } }, null, 2));

    await runInit({ api_key: "sk-merge", skip_service: true });

    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.cursor).toBeDefined();
    expect(content.mcpServers.cursor.command).toBe("x");
    expect(content.mcpServers.synapse).toBeDefined();
    expect(content.mcpServers.synapse.env.SYNAPSE_API_KEY).toBe("sk-merge");
  });

  it("backs up and rewrites an invalid existing .mcp.json", async () => {
    process.chdir(tmp);
    const mcpPath = path.join(tmp, ".mcp.json");
    const corruptContent = "this is not valid json{{{";
    fs.writeFileSync(mcpPath, corruptContent);

    await runInit({ api_key: "sk-corrupt", skip_service: true });

    expect(fs.existsSync(`${mcpPath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${mcpPath}.bak`, "utf-8")).toBe(corruptContent);
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.synapse).toBeDefined();
  });

  it("calls ensureGitignore(cwd, '.mcp.json') whenever cwd .mcp.json is written", async () => {
    process.chdir(tmp);
    const spy = vi.spyOn(editorIo, "ensureGitignore");

    await runInit({ api_key: "sk-gitignore", skip_service: true });

    // On macOS /tmp is a symlink to /private/tmp; process.cwd() returns the
    // resolved path. Normalize the expected arg so the assertion is robust
    // across platforms (Linux returns the unresolved path).
    const resolvedTmp = fs.realpathSync(tmp);
    expect(spy).toHaveBeenCalledWith(resolvedTmp, ".mcp.json");
  });
});
