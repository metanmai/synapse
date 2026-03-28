import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EditorInfo {
  id: string;
  name: string;
  detected: boolean;
  hint: string;
  write: (apiKey: string) => string[];
}

const SYNAPSE_INSTRUCTIONS = `# Synapse — Shared Context Layer

You have access to a Synapse MCP server — a remote workspace for storing and retrieving context across sessions.

## Available Tools
- search — Semantic search across all files (finds by meaning, not just keywords)
- read — Read a file's content
- write — Create or update a file
- ls — List files in a directory
- tree — Show full directory tree
- history — View version history
- rm — Delete a file

## How to Use
1. BEFORE starting any task, search Synapse for existing context: search({ query: "topic" })
2. AFTER completing work, save important context: write({ path: "decisions/topic.md", content: "..." })
3. Use directory prefixes: decisions/, notes/, bugs/, architecture/, projects/<name>/

## Key Behaviors
- Always check Synapse before scanning the codebase — context may already exist
- Save decisions, architecture notes, bug diagnoses, and session summaries to Synapse
- Use semantic search — "auth flow" will find documents about "login and session tokens"
- Never write context to local files unless explicitly asked
`;

// --- Shared helpers ---

function writeMcpJson(filePath: string, apiKey: string): void {
  const serverConfig = {
    mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } } },
  };
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  existing.mcpServers = { ...((existing.mcpServers as Record<string, unknown>) || {}), ...serverConfig.mcpServers };
  fs.writeFileSync(filePath, `${JSON.stringify(existing, null, 2)}\n`);
}

function appendInstructions(filePath: string): boolean {
  let content = "";
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf-8");
  }
  if (content.includes("Synapse")) return false;
  fs.appendFileSync(filePath, `\n${SYNAPSE_INSTRUCTIONS}`);
  return true;
}

// --- Per-editor writers ---

function writeGenericMcp(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  writeMcpJson(path.join(cwd, ".mcp.json"), apiKey);
  written.push(".mcp.json");

  const gitignore = path.join(cwd, ".gitignore");
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, "utf-8");
    if (!content.includes(".mcp.json")) {
      fs.appendFileSync(gitignore, "\n.mcp.json\n");
    }
  }
  return written;
}

function writeCursorEditor(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  const configDir = path.join(cwd, ".cursor");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp.json"), apiKey);
  written.push(".cursor/mcp.json");

  if (appendInstructions(path.join(cwd, ".cursorrules"))) {
    written.push(".cursorrules");
  }
  return written;
}

function writeWindsurfEditor(apiKey: string, home: string, cwd: string): string[] {
  const written: string[] = [];
  const configDir = path.join(home, ".codeium", "windsurf");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp_config.json"), apiKey);
  written.push("~/.codeium/windsurf/mcp_config.json");

  if (appendInstructions(path.join(cwd, ".windsurfrules"))) {
    written.push(".windsurfrules");
  }
  return written;
}

function writeVSCodeEditor(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  const vscodeDir = path.join(cwd, ".vscode");
  fs.mkdirSync(vscodeDir, { recursive: true });
  const settingsFile = path.join(vscodeDir, "settings.json");
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  if (!settings.mcp) settings.mcp = {};
  const mcp = settings.mcp as Record<string, unknown>;
  if (!mcp.servers) mcp.servers = {};
  (mcp.servers as Record<string, unknown>).synapse = {
    command: "npx",
    args: ["synapsesync-mcp"],
    env: { SYNAPSE_API_KEY: apiKey },
  };
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  written.push(".vscode/settings.json");

  const ghDir = path.join(cwd, ".github");
  fs.mkdirSync(ghDir, { recursive: true });
  if (appendInstructions(path.join(ghDir, "copilot-instructions.md"))) {
    written.push(".github/copilot-instructions.md");
  }
  return written;
}

function writeClaudeCodeEditor(apiKey: string, home: string, cwd: string): string[] {
  const written: string[] = [];

  if (appendInstructions(path.join(home, ".claude", "CLAUDE.md"))) {
    written.push("~/.claude/CLAUDE.md");
  }

  const cmdDir = path.join(home, ".claude", "commands", "synapse");
  fs.mkdirSync(cmdDir, { recursive: true });

  const commands: Record<string, string> = {
    "search.md": `Search the Synapse workspace. The search query is: $ARGUMENTS\n\nUses semantic search — understands meaning, not just keywords.\n\nRun \`mcp__synapse__search({ query: "$ARGUMENTS" })\` and display results. If not connected, say "Not connected."\n`,
    "tree.md": `Show the full Synapse workspace file tree.\n\nRun \`mcp__synapse__tree()\` and display the tree. If not connected, say "Not connected."\n`,
    "sync.md":
      "Sync project context to Synapse.\n\n1. Run `mcp__synapse__tree()` to check connection\n2. Summarize recent git changes\n3. Write project overview and recent changes to Synapse\n",
    "whoami.md": `Show current Synapse account info.\n\n1. Run \`mcp__synapse__ls()\` to verify connection\n2. Run \`mcp__synapse__tree()\` to count files\n3. Show: "Connected. Files: [count]."\n`,
    "clean.md":
      "Clean up the Synapse workspace — remove duplicates, test files, and stale entries.\n\n1. Run `mcp__synapse__tree()`\n2. Identify duplicates, test files, empty entries\n3. Confirm with user before deleting\n4. Delete confirmed entries with `mcp__synapse__rm()`\n",
  };

  for (const [filename, content] of Object.entries(commands)) {
    const filepath = path.join(cmdDir, filename);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, content);
      written.push(`~/.claude/commands/synapse/${filename}`);
    }
  }

  written.push(...writeGenericMcp(apiKey, cwd));
  return written;
}

// --- Public API ---

export function detectEditors(): EditorInfo[] {
  const home = os.homedir();
  const cwd = process.cwd();

  return [
    {
      id: "claude-code",
      name: "Claude Code",
      detected: fs.existsSync(path.join(home, ".claude")),
      hint: "~/.claude/CLAUDE.md + commands",
      write: (apiKey) => writeClaudeCodeEditor(apiKey, home, cwd),
    },
    {
      id: "cursor",
      name: "Cursor",
      detected: fs.existsSync(path.join(cwd, ".cursor")) || fs.existsSync(path.join(cwd, ".cursorrules")),
      hint: ".cursor/mcp.json + .cursorrules",
      write: (apiKey) => writeCursorEditor(apiKey, cwd),
    },
    {
      id: "windsurf",
      name: "Windsurf",
      detected: fs.existsSync(path.join(home, ".codeium")),
      hint: "~/.codeium/windsurf/mcp_config.json",
      write: (apiKey) => writeWindsurfEditor(apiKey, home, cwd),
    },
    {
      id: "vscode",
      name: "VS Code",
      detected: fs.existsSync(path.join(cwd, ".vscode")),
      hint: ".vscode/settings.json + copilot-instructions",
      write: (apiKey) => writeVSCodeEditor(apiKey, cwd),
    },
    {
      id: "generic",
      name: "Generic MCP",
      detected: true,
      hint: ".mcp.json",
      write: (apiKey) => writeGenericMcp(apiKey, cwd),
    },
  ];
}

export function writeEditorConfigs(editors: EditorInfo[], apiKey: string): string[] {
  const written: string[] = [];
  for (const editor of editors) {
    written.push(...editor.write(apiKey));
  }
  return [...new Set(written)];
}

export function writeAllDetected(apiKey: string): string[] {
  return writeEditorConfigs(
    detectEditors().filter((e) => e.detected),
    apiKey,
  );
}
