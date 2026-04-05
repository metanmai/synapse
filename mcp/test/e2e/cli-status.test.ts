/**
 * End-to-end tests for the `status` CLI command.
 *
 * Spawns `node dist/index.js status` as a child process with temp HOME/CWD
 * and asserts the terminal output shows correct per-location connection status.
 *
 * Run:  TEST_E2E=1 npm run test:e2e
 *
 * Without TEST_E2E=1 the suite is skipped.
 * Without a real API key (TEST_SYNAPSE_API_KEY), key-validation tests are skipped.
 */
import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.TEST_E2E === "1";
const suite = RUN ? describe : describe.skip;

const BIN = path.resolve(__dirname, "../../dist/index.js");

/** Strip ANSI escape codes from terminal output. */
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching control chars
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Run the CLI with custom HOME and CWD, return stripped stdout+stderr. */
function runStatus(home: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = child_process.spawn("node", [BIN, "status"], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        NO_COLOR: "1", // disable color for easier assertions
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      resolve({ stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), code });
    });
  });
}

/** Write a standard MCP JSON config with synapse entry. */
function writeMcpConfig(filePath: string, apiKey?: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = {};
  if (apiKey) env.SYNAPSE_API_KEY = apiKey;
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env } },
      },
      null,
      2,
    ),
  );
}

suite("CLI status — per-location display", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeAll(() => {
    // Ensure the binary is built
    expect(fs.existsSync(BIN)).toBe(true);
  });

  afterAll(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
    if (tmpCwd) fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  // Fresh temp dirs per test to avoid cross-contamination
  function freshDirs() {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
    if (tmpCwd) fs.rmSync(tmpCwd, { recursive: true, force: true });
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "syn-e2e-home-"));
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "syn-e2e-cwd-"));
  }

  it("shows 'not configured' when no config files exist", async () => {
    freshDirs();
    const { stdout } = await runStatus(tmpHome, tmpCwd);
    expect(stdout).toContain("not configured");
  });

  it("shows 'missing API key' for config with synapse entry but no key", async () => {
    freshDirs();
    writeMcpConfig(path.join(tmpCwd, ".mcp.json")); // no API key
    const { stdout } = await runStatus(tmpHome, tmpCwd);
    expect(stdout).toContain("missing API key");
    expect(stdout).toContain(".mcp.json");
  });

  it("shows 'instructions only' for CLAUDE.md with Synapse mention", async () => {
    freshDirs();
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Synapse\nInstructions.");

    const { stdout } = await runStatus(tmpHome, tmpCwd);
    expect(stdout).toContain("instructions only");
    expect(stdout).toContain("CLAUDE.md");
  });

  it("shows mixed statuses across multiple locations", async () => {
    freshDirs();

    // .mcp.json — has key (will fail validation but still shows as configured)
    writeMcpConfig(path.join(tmpCwd, ".mcp.json"), "sk-fake-key");

    // .cursor/mcp.json — no key
    writeMcpConfig(path.join(tmpCwd, ".cursor", "mcp.json"));

    // CLAUDE.md — instructions only
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Synapse\nContext layer.");

    const { stdout } = await runStatus(tmpHome, tmpCwd);

    // Should show all three locations
    expect(stdout).toContain(".mcp.json");
    expect(stdout).toContain(".cursor/mcp.json");
    expect(stdout).toContain("CLAUDE.md");

    // .cursor/mcp.json should show missing key
    expect(stdout).toContain("missing API key");
    // CLAUDE.md should show instructions only
    expect(stdout).toContain("instructions only");
  });

  it("shows each location on its own line", async () => {
    freshDirs();
    writeMcpConfig(path.join(tmpCwd, ".mcp.json"), "sk-fake");
    writeMcpConfig(path.join(tmpCwd, ".cursor", "mcp.json"));

    const { stdout } = await runStatus(tmpHome, tmpCwd);
    const lines = stdout.split("\n");

    const mcpLine = lines.find((l) => l.includes(".mcp.json") && !l.includes(".cursor"));
    const cursorLine = lines.find((l) => l.includes(".cursor/mcp.json"));

    expect(mcpLine).toBeDefined();
    expect(cursorLine).toBeDefined();
    // They should be different lines
    expect(mcpLine).not.toBe(cursorLine);
  });

  // This test requires a real API key — skip if not available
  const REAL_KEY = process.env.TEST_SYNAPSE_API_KEY ?? "";
  const keyTest = REAL_KEY ? it : it.skip;

  keyTest("shows 'connected' for location with a valid API key", async () => {
    freshDirs();
    writeMcpConfig(path.join(tmpCwd, ".mcp.json"), REAL_KEY);

    const { stdout } = await runStatus(tmpHome, tmpCwd);
    expect(stdout).toContain("connected");
    expect(stdout).toContain(".mcp.json");
    // Should also show account info (Tier, Files)
    expect(stdout).toMatch(/Tier/i);
  });

  keyTest("shows 'connected' and 'missing API key' side by side", async () => {
    freshDirs();
    // One config with valid key, one without
    writeMcpConfig(path.join(tmpCwd, ".mcp.json"), REAL_KEY);
    writeMcpConfig(path.join(tmpCwd, ".cursor", "mcp.json")); // no key

    const { stdout } = await runStatus(tmpHome, tmpCwd);
    expect(stdout).toContain("connected");
    expect(stdout).toContain("missing API key");
  });
});
