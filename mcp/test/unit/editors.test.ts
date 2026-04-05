import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track our test directories via mutable variable read by the mock at call-time.
let tmpDir: string;
let tmpHomeDir: string;

// Mock node:os — the source file does `import os from "node:os"` (default import).
// We need to override the `default` export so that `os.homedir()` returns our tmpHomeDir.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => tmpHomeDir,
    },
    homedir: () => tmpHomeDir,
  };
});

// Import after mock setup — editors.ts will get the mocked os module
import {
  type SetupScope,
  detectEditors,
  detectExistingSetup,
  writeAllDetected,
  writeEditorConfigs,
} from "../../src/cli/editors/index.js";

/** Find an editor by id, throwing if not found (avoids non-null assertion lint errors). */
function findEditor(editors: ReturnType<typeof detectEditors>, id: string) {
  const editor = editors.find((e) => e.id === id);
  if (!editor) throw new Error(`Editor "${id}" not found`);
  return editor;
}

function mkTempDir(prefix: string): string {
  // Use real tmpdir (from the named import captured before mock)
  return fs.mkdtempSync(path.join(tmpdir(), prefix));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("editors", () => {
  beforeEach(() => {
    tmpDir = mkTempDir("synapse-test-cwd-");
    tmpHomeDir = mkTempDir("synapse-test-home-");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmrf(tmpDir);
    rmrf(tmpHomeDir);
  });

  // ─── detectEditors ─────────────────────────────────────────────────

  describe("detectEditors", () => {
    it("local scope returns Claude Code, Cursor, Windsurf, VS Code, and Generic MCP", () => {
      const editors = detectEditors("local");
      const ids = editors.map((e) => e.id);
      expect(ids).toContain("claude-code");
      expect(ids).toContain("cursor");
      expect(ids).toContain("windsurf");
      expect(ids).toContain("vscode");
      expect(ids).toContain("generic");
      expect(editors.length).toBe(5);
    });

    it("global scope returns Claude Code, Cursor, Windsurf, VS Code (no Generic)", () => {
      const editors = detectEditors("global");
      const ids = editors.map((e) => e.id);
      expect(ids).toContain("claude-code");
      expect(ids).toContain("cursor");
      expect(ids).toContain("windsurf");
      expect(ids).toContain("vscode");
      expect(ids).not.toContain("generic");
      expect(editors.length).toBe(4);
    });

    it("each editor has id, name, detected (boolean), hint (string), and write (function)", () => {
      for (const scope of ["local", "global"] as SetupScope[]) {
        const editors = detectEditors(scope);
        for (const editor of editors) {
          expect(typeof editor.id).toBe("string");
          expect(editor.id.length).toBeGreaterThan(0);
          expect(typeof editor.name).toBe("string");
          expect(editor.name.length).toBeGreaterThan(0);
          expect(typeof editor.detected).toBe("boolean");
          expect(typeof editor.hint).toBe("string");
          expect(editor.hint.length).toBeGreaterThan(0);
          expect(typeof editor.write).toBe("function");
        }
      }
    });

    it("detects Cursor when .cursor/ exists in cwd", () => {
      fs.mkdirSync(path.join(tmpDir, ".cursor"), { recursive: true });
      const editors = detectEditors("local");
      const cursor = editors.find((e) => e.id === "cursor");
      expect(cursor?.detected).toBe(true);
    });

    it("does not detect Cursor when .cursor/ is missing from cwd", () => {
      const editors = detectEditors("local");
      const cursor = editors.find((e) => e.id === "cursor");
      expect(cursor?.detected).toBe(false);
    });

    it("detects Cursor when .cursorrules exists in cwd", () => {
      fs.writeFileSync(path.join(tmpDir, ".cursorrules"), "# rules\n");
      const editors = detectEditors("local");
      const cursor = editors.find((e) => e.id === "cursor");
      expect(cursor?.detected).toBe(true);
    });

    it("detects Claude Code when .claude/ exists in homedir", () => {
      fs.mkdirSync(path.join(tmpHomeDir, ".claude"), { recursive: true });
      const editors = detectEditors("local");
      const claude = editors.find((e) => e.id === "claude-code");
      expect(claude?.detected).toBe(true);
    });

    it("does not detect Claude Code when .claude/ is missing from homedir", () => {
      const editors = detectEditors("local");
      const claude = editors.find((e) => e.id === "claude-code");
      expect(claude?.detected).toBe(false);
    });

    it("detects VS Code in local scope when .vscode/ exists in cwd", () => {
      fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
      const editors = detectEditors("local");
      const vscode = editors.find((e) => e.id === "vscode");
      expect(vscode?.detected).toBe(true);
    });

    it("detects Windsurf when .codeium/ exists in homedir", () => {
      fs.mkdirSync(path.join(tmpHomeDir, ".codeium"), { recursive: true });
      const editors = detectEditors("local");
      const windsurf = editors.find((e) => e.id === "windsurf");
      expect(windsurf?.detected).toBe(true);
    });

    it("Generic MCP is always detected in local scope", () => {
      const editors = detectEditors("local");
      const generic = editors.find((e) => e.id === "generic");
      expect(generic?.detected).toBe(true);
    });
  });

  // ─── writeEditorConfigs ────────────────────────────────────────────

  describe("writeEditorConfigs", () => {
    it("writes MCP JSON files with correct structure for each editor", () => {
      const editors = detectEditors("local");
      const generic = editors.filter((e) => e.id === "generic");
      const result = writeEditorConfigs(generic, "sk-test-key");

      expect(result.written.length).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);

      const mcpJson = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"));
      expect(mcpJson.mcpServers).toBeDefined();
      expect(mcpJson.mcpServers.synapse).toBeDefined();
      expect(mcpJson.mcpServers.synapse.command).toBe("npx");
      expect(mcpJson.mcpServers.synapse.args).toEqual(["synapsesync-mcp"]);
      expect(mcpJson.mcpServers.synapse.env.SYNAPSE_API_KEY).toBe("sk-test-key");
    });

    it("written files contain synapsesync-mcp in mcpServers", () => {
      const editors = detectEditors("local");
      const generic = editors.filter((e) => e.id === "generic");
      writeEditorConfigs(generic, "sk-key-123");

      const content = fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8");
      expect(content).toContain("synapsesync-mcp");
    });

    it("returns written file list and empty errors array on success", () => {
      const editors = detectEditors("local");
      const generic = editors.filter((e) => e.id === "generic");
      const result = writeEditorConfigs(generic, "sk-test");

      expect(Array.isArray(result.written)).toBe(true);
      expect(result.written.length).toBeGreaterThan(0);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("on write error, captures error in errors array and continues with other editors", () => {
      // Make the mcp.json location a directory to cause EISDIR
      const readonlyDir = path.join(tmpDir, ".cursor");
      fs.mkdirSync(readonlyDir, { recursive: true });
      fs.mkdirSync(path.join(readonlyDir, "mcp.json"), { recursive: true });

      const editors = detectEditors("local");
      const cursorAndGeneric = editors.filter((e) => e.id === "cursor" || e.id === "generic");
      const result = writeEditorConfigs(cursorAndGeneric, "sk-test");

      // Generic should succeed, Cursor should fail
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => e.editor === "Cursor")).toBe(true);
      // Generic MCP writes should still succeed
      expect(result.written.some((f) => f.includes(".mcp.json"))).toBe(true);
    });

    it("idempotency: running twice does not duplicate entries in JSON files", () => {
      const editors = detectEditors("local");
      const generic = editors.filter((e) => e.id === "generic");

      writeEditorConfigs(generic, "sk-test");
      writeEditorConfigs(generic, "sk-test");

      const mcpJson = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8"));
      const serverKeys = Object.keys(mcpJson.mcpServers);
      const synapseCount = serverKeys.filter((k) => k === "synapse").length;
      expect(synapseCount).toBe(1);
    });
  });

  // ─── writeMcpJson (tested via Generic MCP write) ──────────────────

  describe("writeMcpJson (via editor writes)", () => {
    it("creates new file with correct JSON structure", () => {
      const editors = detectEditors("local");
      const generic = findEditor(editors, "generic");
      generic.write("sk-new-key");

      const filePath = path.join(tmpDir, ".mcp.json");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.mcpServers.synapse.command).toBe("npx");
      expect(content.mcpServers.synapse.args).toEqual(["synapsesync-mcp"]);
      expect(content.mcpServers.synapse.env.SYNAPSE_API_KEY).toBe("sk-new-key");
    });

    it("merges with existing mcpServers", () => {
      const filePath = path.join(tmpDir, ".mcp.json");
      fs.writeFileSync(filePath, JSON.stringify({ mcpServers: { other: { command: "other-tool" } } }, null, 2));

      const editors = detectEditors("local");
      const generic = findEditor(editors, "generic");
      generic.write("sk-merge-key");

      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.mcpServers.other).toBeDefined();
      expect(content.mcpServers.other.command).toBe("other-tool");
      expect(content.mcpServers.synapse).toBeDefined();
      expect(content.mcpServers.synapse.env.SYNAPSE_API_KEY).toBe("sk-merge-key");
    });

    it("backs up corrupted JSON to .bak", () => {
      const filePath = path.join(tmpDir, ".mcp.json");
      fs.writeFileSync(filePath, "this is not valid JSON{{{");

      const editors = detectEditors("local");
      const generic = findEditor(editors, "generic");
      generic.write("sk-corrupt-key");

      expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
      expect(fs.readFileSync(`${filePath}.bak`, "utf-8")).toBe("this is not valid JSON{{{");

      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.mcpServers.synapse).toBeDefined();
    });
  });

  // ─── appendInstructions (tested via Cursor local write) ───────────

  describe("appendInstructions (via editor writes)", () => {
    it("adds Synapse instructions block to .cursorrules", () => {
      const editors = detectEditors("local");
      const cursor = findEditor(editors, "cursor");
      cursor.write("sk-test");

      const rulesPath = path.join(tmpDir, ".cursorrules");
      expect(fs.existsSync(rulesPath)).toBe(true);
      const content = fs.readFileSync(rulesPath, "utf-8");
      expect(content).toContain("Synapse");
      expect(content).toContain("Available Tools");
    });

    it("skips if already present (idempotent)", () => {
      const editors = detectEditors("local");
      const cursor = findEditor(editors, "cursor");
      cursor.write("sk-test");
      const contentAfterFirst = fs.readFileSync(path.join(tmpDir, ".cursorrules"), "utf-8");

      // Write again
      cursor.write("sk-test");
      const contentAfterSecond = fs.readFileSync(path.join(tmpDir, ".cursorrules"), "utf-8");

      expect(contentAfterFirst).toBe(contentAfterSecond);
    });

    it("preserves existing content in instructions files", () => {
      const rulesPath = path.join(tmpDir, ".cursorrules");
      fs.writeFileSync(rulesPath, "# My existing rules\nBe helpful.\n");

      const editors = detectEditors("local");
      const cursor = findEditor(editors, "cursor");
      cursor.write("sk-test");

      const content = fs.readFileSync(rulesPath, "utf-8");
      expect(content).toContain("# My existing rules");
      expect(content).toContain("Synapse");
    });
  });

  // ─── ensureGitignore (tested via Generic MCP write) ────────────────

  describe("ensureGitignore (via editor writes)", () => {
    it("creates .gitignore if missing", () => {
      const editors = detectEditors("local");
      const generic = findEditor(editors, "generic");
      generic.write("sk-test");

      const gitignore = path.join(tmpDir, ".gitignore");
      expect(fs.existsSync(gitignore)).toBe(true);
      const content = fs.readFileSync(gitignore, "utf-8");
      expect(content).toContain(".mcp.json");
    });

    it("appends entry without duplicates", () => {
      const gitignore = path.join(tmpDir, ".gitignore");
      fs.writeFileSync(gitignore, "node_modules/\n");

      const editors = detectEditors("local");
      const generic = findEditor(editors, "generic");
      generic.write("sk-test");
      generic.write("sk-test"); // write twice

      const content = fs.readFileSync(gitignore, "utf-8");
      const matches = content.match(/\.mcp\.json/g);
      expect(matches?.length).toBe(1);
    });

    it("handles missing newline at end of file", () => {
      const gitignore = path.join(tmpDir, ".gitignore");
      fs.writeFileSync(gitignore, "node_modules/"); // no trailing newline

      const editors = detectEditors("local");
      const generic = findEditor(editors, "generic");
      generic.write("sk-test");

      const content = fs.readFileSync(gitignore, "utf-8");
      // The entry should be on its own line
      expect(content).toContain("node_modules/\n.mcp.json");
    });
  });

  // ─── writeJsonSafe (tested via VS Code local write) ────────────────

  describe("writeJsonSafe (via VS Code writes)", () => {
    it("creates .vscode/mcp.json", () => {
      const editors = detectEditors("local");
      const vscode = findEditor(editors, "vscode");
      vscode.write("sk-test");

      expect(fs.existsSync(path.join(tmpDir, ".vscode", "mcp.json"))).toBe(true);
    });

    it("backs up invalid JSON (arrays)", () => {
      const settingsDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(settingsDir, { recursive: true });
      const mcpPath = path.join(settingsDir, "mcp.json");
      fs.writeFileSync(mcpPath, "[1, 2, 3]");

      const editors = detectEditors("local");
      const vscode = findEditor(editors, "vscode");
      vscode.write("sk-test");

      expect(fs.existsSync(`${mcpPath}.bak`)).toBe(true);
      expect(fs.readFileSync(`${mcpPath}.bak`, "utf-8")).toBe("[1, 2, 3]");
    });

    it("backs up corrupted JSON", () => {
      const settingsDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(settingsDir, { recursive: true });
      const mcpPath = path.join(settingsDir, "mcp.json");
      fs.writeFileSync(mcpPath, "not json at all!!!");

      const editors = detectEditors("local");
      const vscode = findEditor(editors, "vscode");
      vscode.write("sk-test");

      expect(fs.existsSync(`${mcpPath}.bak`)).toBe(true);
      const newContent = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      expect(newContent.servers.synapse).toBeDefined();
    });

    it("merges with valid existing JSON", () => {
      const settingsDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(settingsDir, { recursive: true });
      const mcpPath = path.join(settingsDir, "mcp.json");
      fs.writeFileSync(mcpPath, JSON.stringify({ servers: { other: { command: "x" } } }, null, 2));

      const editors = detectEditors("local");
      const vscode = findEditor(editors, "vscode");
      vscode.write("sk-test");

      const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      expect(content.servers.other.command).toBe("x");
      expect(content.servers.synapse).toBeDefined();
    });
  });

  // ─── Command/prompt/workflow writers ───────────────────────────────

  describe("Cursor commands", () => {
    it("creates .cursor/commands/synapse-*.md files", () => {
      const editors = detectEditors("local");
      const cursor = findEditor(editors, "cursor");
      cursor.write("sk-test");

      const cmdDir = path.join(tmpDir, ".cursor", "commands");
      expect(fs.existsSync(cmdDir)).toBe(true);
      const files = fs.readdirSync(cmdDir);
      const synapseFiles = files.filter((f) => f.startsWith("synapse-") && f.endsWith(".md"));
      expect(synapseFiles.length).toBe(9);
    });

    it("command files have content", () => {
      const editors = detectEditors("local");
      const cursor = findEditor(editors, "cursor");
      cursor.write("sk-test");

      const cmdDir = path.join(tmpDir, ".cursor", "commands");
      const files = fs.readdirSync(cmdDir);
      for (const file of files) {
        const content = fs.readFileSync(path.join(cmdDir, file), "utf-8");
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it("skips existing files (idempotent)", () => {
      const editors = detectEditors("local");
      const cursor = findEditor(editors, "cursor");
      cursor.write("sk-test");

      // Modify one file
      const cmdDir = path.join(tmpDir, ".cursor", "commands");
      const target = path.join(cmdDir, "synapse-search.md");
      fs.writeFileSync(target, "custom content");

      cursor.write("sk-test");
      expect(fs.readFileSync(target, "utf-8")).toBe("custom content");
    });
  });

  describe("VS Code prompts", () => {
    it("creates .github/prompts/synapse-*.prompt.md files with YAML frontmatter", () => {
      const editors = detectEditors("local");
      const vscode = findEditor(editors, "vscode");
      vscode.write("sk-test");

      const promptDir = path.join(tmpDir, ".github", "prompts");
      expect(fs.existsSync(promptDir)).toBe(true);
      const files = fs.readdirSync(promptDir);
      const synapseFiles = files.filter((f) => f.startsWith("synapse-") && f.endsWith(".prompt.md"));
      expect(synapseFiles.length).toBe(9);

      // Verify YAML frontmatter
      for (const file of synapseFiles) {
        const content = fs.readFileSync(path.join(promptDir, file), "utf-8");
        expect(content.startsWith("---\n")).toBe(true);
        expect(content).toContain("description:");
        expect(content).toContain('mode: "agent"');
      }
    });

    it("skips existing files (idempotent)", () => {
      const editors = detectEditors("local");
      const vscode = findEditor(editors, "vscode");
      vscode.write("sk-test");

      const promptDir = path.join(tmpDir, ".github", "prompts");
      const target = path.join(promptDir, "synapse-search.prompt.md");
      fs.writeFileSync(target, "custom prompt content");

      vscode.write("sk-test");
      expect(fs.readFileSync(target, "utf-8")).toBe("custom prompt content");
    });
  });

  describe("Windsurf workflows", () => {
    it("creates .windsurf/workflows/synapse-*.md files", () => {
      const editors = detectEditors("local");
      const windsurf = findEditor(editors, "windsurf");
      windsurf.write("sk-test");

      const workflowDir = path.join(tmpDir, ".windsurf", "workflows");
      expect(fs.existsSync(workflowDir)).toBe(true);
      const files = fs.readdirSync(workflowDir);
      const synapseFiles = files.filter((f) => f.startsWith("synapse-") && f.endsWith(".md"));
      expect(synapseFiles.length).toBe(9);
    });

    it("skips existing files (idempotent)", () => {
      const editors = detectEditors("local");
      const windsurf = findEditor(editors, "windsurf");
      windsurf.write("sk-test");

      const workflowDir = path.join(tmpDir, ".windsurf", "workflows");
      const target = path.join(workflowDir, "synapse-tree.md");
      fs.writeFileSync(target, "custom workflow");

      windsurf.write("sk-test");
      expect(fs.readFileSync(target, "utf-8")).toBe("custom workflow");
    });
  });

  // ─── detectExistingSetup ───────────────────────────────────────────

  describe("detectExistingSetup", () => {
    /** Helper: get labels from locations */
    const labels = (result: ReturnType<typeof detectExistingSetup>) => result.locations.map((l) => l.label);

    it("returns {configured: false, locations: [], apiKeys: []} when no configs exist", () => {
      const result = detectExistingSetup();
      expect(result.configured).toBe(false);
      expect(result.locations).toEqual([]);
      expect(result.apiKeys).toEqual([]);
    });

    it("detects .mcp.json with synapsesync-mcp entry", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-found" } } },
        }),
      );

      const result = detectExistingSetup();
      expect(result.configured).toBe(true);
      expect(labels(result)).toContain(".mcp.json");
    });

    it("detects .cursor/mcp.json with synapsesync-mcp entry", () => {
      const cursorDir = path.join(tmpDir, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-cursor" } } },
        }),
      );

      const result = detectExistingSetup();
      expect(result.configured).toBe(true);
      expect(labels(result)).toContain(".cursor/mcp.json");
    });

    it("extracts API key from found config", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-extracted-key" } },
          },
        }),
      );

      const result = detectExistingSetup();
      expect(result.apiKeys).toContain("sk-extracted-key");
    });

    it("collects multiple unique API keys from different config files", () => {
      // Local .mcp.json has key A
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-local" } } },
        }),
      );
      // Global ~/.claude/.mcp.json has key B
      const claudeDir = path.join(tmpHomeDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-global" } } },
        }),
      );

      const result = detectExistingSetup();
      expect(result.apiKeys).toContain("sk-local");
      expect(result.apiKeys).toContain("sk-global");
      expect(result.apiKeys).toHaveLength(2);
    });

    it("deduplicates identical API keys across config files", () => {
      const sameKey = "sk-same-everywhere";
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: sameKey } } },
        }),
      );
      const cursorDir = path.join(tmpDir, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: sameKey } } },
        }),
      );

      const result = detectExistingSetup();
      expect(result.apiKeys).toEqual([sameKey]);
    });

    it("handles corrupted JSON gracefully", () => {
      fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "not valid json{{{");

      const result = detectExistingSetup();
      expect(labels(result)).not.toContain(".mcp.json");
      expect(result.apiKeys).toEqual([]);
    });

    it("detects CLAUDE.md with Synapse mention", () => {
      const claudeDir = path.join(tmpHomeDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Synapse context layer\nSome content.");

      const result = detectExistingSetup();
      expect(result.configured).toBe(true);
      expect(labels(result)).toContain("~/.claude/CLAUDE.md");
    });

    it("does not detect CLAUDE.md without Synapse mention", () => {
      const claudeDir = path.join(tmpHomeDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Just some rules\nBe helpful.");

      const result = detectExistingSetup();
      expect(labels(result)).not.toContain("~/.claude/CLAUDE.md");
    });

    // ─── Per-location status ────────────────────────────────────────

    it("marks location as 'has_key' when API key is present", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-test" } } },
        }),
      );

      const result = detectExistingSetup();
      const loc = result.locations.find((l) => l.label === ".mcp.json");
      expect(loc).toBeDefined();
      expect(loc?.status).toBe("has_key");
      expect(loc?.apiKey).toBe("sk-test");
    });

    it("marks location as 'no_key' when synapse config exists but env is empty", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: {} } },
        }),
      );

      const result = detectExistingSetup();
      const loc = result.locations.find((l) => l.label === ".mcp.json");
      expect(loc).toBeDefined();
      expect(loc?.status).toBe("no_key");
      expect(loc?.apiKey).toBeNull();
    });

    it("marks location as 'no_key' when synapse config has no env at all", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "node", args: ["/some/path"] } },
        }),
      );

      const result = detectExistingSetup();
      const loc = result.locations.find((l) => l.label === ".mcp.json");
      expect(loc).toBeDefined();
      expect(loc?.status).toBe("no_key");
      expect(loc?.apiKey).toBeNull();
    });

    it("marks CLAUDE.md as 'instructions_only'", () => {
      const claudeDir = path.join(tmpHomeDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Synapse\nInstructions here.");

      const result = detectExistingSetup();
      const loc = result.locations.find((l) => l.label === "~/.claude/CLAUDE.md");
      expect(loc).toBeDefined();
      expect(loc?.status).toBe("instructions_only");
      expect(loc?.apiKey).toBeNull();
    });

    it("shows mixed statuses across locations", () => {
      // .mcp.json has a key
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-good" } } },
        }),
      );
      // .cursor/mcp.json has synapse but no key
      const cursorDir = path.join(tmpDir, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: {} } },
        }),
      );
      // CLAUDE.md has instructions
      const claudeDir = path.join(tmpHomeDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# Synapse instructions");

      const result = detectExistingSetup();
      expect(result.locations).toHaveLength(3);

      const mcp = result.locations.find((l) => l.label === ".mcp.json");
      const cursor = result.locations.find((l) => l.label === ".cursor/mcp.json");
      const claude = result.locations.find((l) => l.label === "~/.claude/CLAUDE.md");

      expect(mcp?.status).toBe("has_key");
      expect(cursor?.status).toBe("no_key");
      expect(claude?.status).toBe("instructions_only");

      // Only one unique API key
      expect(result.apiKeys).toEqual(["sk-good"]);
    });

    it("location objects include the absolute file path", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: "sk-x" } } },
        }),
      );

      const result = detectExistingSetup();
      const loc = result.locations.find((l) => l.label === ".mcp.json");
      expect(loc?.filePath).toBe(path.join(tmpDir, ".mcp.json"));
    });
  });

  // ─── writeAllDetected ──────────────────────────────────────────────

  describe("writeAllDetected", () => {
    it("writes configs only for detected editors", () => {
      // Only Generic MCP is always detected in local scope
      const result = writeAllDetected("sk-test", "local");
      expect(result.written.length).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });

    it("writes configs for all detected editors in global scope", () => {
      // Create .claude and .cursor to trigger detection
      fs.mkdirSync(path.join(tmpHomeDir, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(tmpHomeDir, ".cursor"), { recursive: true });

      const result = writeAllDetected("sk-test", "global");
      expect(result.written.length).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── Claude Code write tests ───────────────────────────────────────

  describe("Claude Code local writer", () => {
    it("writes CLAUDE.md instructions and .mcp.json", () => {
      const editors = detectEditors("local");
      const claude = findEditor(editors, "claude-code");
      const written = claude.write("sk-claude-key");

      expect(written.some((f) => f.includes("CLAUDE.md"))).toBe(true);
      expect(written.some((f) => f.includes(".mcp.json"))).toBe(true);
    });

    it("creates Claude Code command files", () => {
      const editors = detectEditors("local");
      const claude = findEditor(editors, "claude-code");
      claude.write("sk-test");

      const cmdDir = path.join(tmpHomeDir, ".claude", "commands", "synapse");
      expect(fs.existsSync(cmdDir)).toBe(true);
      const files = fs.readdirSync(cmdDir);
      expect(files.length).toBe(9);
      expect(files).toContain("search.md");
      expect(files).toContain("tree.md");
      expect(files).toContain("sync.md");
      expect(files).toContain("whoami.md");
      expect(files).toContain("clean.md");
      expect(files).toContain("list-convos.md");
      expect(files).toContain("load-convo.md");
      expect(files).toContain("sync-convo.md");
      expect(files).toContain("insights.md");
    });

    it("command files are idempotent (skip existing)", () => {
      const editors = detectEditors("local");
      const claude = findEditor(editors, "claude-code");
      claude.write("sk-test");

      const target = path.join(tmpHomeDir, ".claude", "commands", "synapse", "search.md");
      fs.writeFileSync(target, "custom search command");

      claude.write("sk-test");
      expect(fs.readFileSync(target, "utf-8")).toBe("custom search command");
    });
  });

  describe("Claude Code global writer", () => {
    it("writes CLAUDE.md instructions and ~/.claude.json", () => {
      const editors = detectEditors("global");
      const claude = findEditor(editors, "claude-code");
      const written = claude.write("sk-global-key");

      expect(written.some((f) => f.includes("CLAUDE.md"))).toBe(true);
      expect(written.some((f) => f.includes(".claude.json"))).toBe(true);

      const mcpPath = path.join(tmpHomeDir, ".claude.json");
      expect(fs.existsSync(mcpPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      expect(content.mcpServers.synapse.env.SYNAPSE_API_KEY).toBe("sk-global-key");
    });
  });
});
