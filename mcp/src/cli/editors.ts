import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SetupScope = "local" | "global";

export interface EditorInfo {
  id: string;
  name: string;
  detected: boolean;
  hint: string;
  write: (apiKey: string) => string[];
}

export interface WriteResult {
  written: string[];
  errors: { editor: string; error: string }[];
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
1. BEFORE writing anything, run tree() to see the existing workspace structure
2. BEFORE starting any task, search Synapse for existing context: search({ query: "topic" })
3. AFTER completing work, save context to the RIGHT location by following the existing structure:
   - Project-specific context (decisions, bugs, changelogs, architecture) → under the project's directory (e.g. projects/<name>/)
   - Cross-project decisions, research, retrospectives → root-level directories
   - Settings and configuration → settings/
   - Determine the project name from the repo, codebase, or conversation context — not from a hardcoded value

## Key Behaviors
- Always check the tree FIRST to understand the existing directory layout before writing
- Place files where they logically belong based on what already exists — don't create new top-level directories if a matching one exists
- Use semantic search — "auth flow" will find documents about "login and session tokens"
- Never write context to local files unless explicitly asked
`;

// --- Slash command / prompt definitions (shared across editors) ---

interface CommandDef {
  description: string;
  body: string;
}

const SYNAPSE_COMMAND_DEFS: Record<string, CommandDef> = {
  "synapse-search": {
    description: "Search the Synapse workspace using semantic search",
    body: "Search the Synapse workspace using semantic search. Find files by meaning, not just keywords.\n\nUse the Synapse MCP `search` tool with the user's query. Display matching files with paths and relevant snippets.",
  },
  "synapse-tree": {
    description: "Show the full Synapse workspace file tree",
    body: "Show the full Synapse workspace file tree.\n\nUse the Synapse MCP `tree` tool and display the result in a readable format.",
  },
  "synapse-sync": {
    description: "Sync project context to Synapse",
    body: "Sync project context to Synapse.\n\n1. Run `tree()` to see the existing workspace structure\n2. Determine the current project name from the repo/codebase\n3. Check `ls({ path: \"projects/<name>\" })` for existing context\n4. Summarize recent git changes\n5. Write overview and recent changes under the project's directory\n6. Place files where they fit the existing structure — don't create new top-level dirs if a matching one exists",
  },
  "synapse-whoami": {
    description: "Show Synapse workspace info",
    body: 'Show current Synapse workspace info.\n\n1. Use the Synapse MCP `ls` tool to verify connection\n2. Use the Synapse MCP `tree` tool to count files\n3. Report: "Connected to Synapse. [count] files in workspace."',
  },
  "synapse-clean": {
    description: "Clean up the Synapse workspace",
    body: "Clean up the Synapse workspace — remove duplicates, test files, and stale entries.\n\n1. Use the Synapse MCP `tree` tool to list all files\n2. Identify duplicates, test files, empty entries\n3. Confirm with the user before deleting anything\n4. Delete confirmed entries using the Synapse MCP `rm` tool",
  },
};

// --- Shared helpers ---

function synapseMcpServer(apiKey: string): Record<string, unknown> {
  return { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } };
}

function writeMcpJson(filePath: string, apiKey: string): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
  }
  existing.mcpServers = {
    ...((existing.mcpServers as Record<string, unknown>) || {}),
    synapse: synapseMcpServer(apiKey),
  };
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

function ensureGitignore(cwd: string, entry: string): void {
  const gitignore = path.join(cwd, ".gitignore");
  let content = "";
  if (fs.existsSync(gitignore)) {
    content = fs.readFileSync(gitignore, "utf-8");
  }
  if (!content.includes(entry)) {
    fs.appendFileSync(gitignore, `${content.length > 0 && !content.endsWith("\n") ? "\n" : ""}${entry}\n`);
  }
}

function writeJsonSafe(filePath: string, updater: (obj: Record<string, unknown>) => void): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = parsed;
      } else {
        fs.copyFileSync(filePath, `${filePath}.bak`);
      }
    } catch {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
  }
  updater(settings);
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

function globalConfigDir(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

// --- Command / prompt / workflow writers ---

/** Write Cursor-style commands to a commands/ directory. */
function writeCursorCommandFiles(baseDir: string, pathPrefix: string): string[] {
  const written: string[] = [];
  const cmdDir = path.join(baseDir, "commands");
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const [name, def] of Object.entries(SYNAPSE_COMMAND_DEFS)) {
    const filepath = path.join(cmdDir, `${name}.md`);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, `${def.body}\n`);
      written.push(`${pathPrefix}commands/${name}.md`);
    }
  }
  return written;
}

/** Write VS Code Copilot prompt files to .github/prompts/. */
function writeVSCodePromptFiles(cwd: string): string[] {
  const written: string[] = [];
  const promptDir = path.join(cwd, ".github", "prompts");
  fs.mkdirSync(promptDir, { recursive: true });
  for (const [name, def] of Object.entries(SYNAPSE_COMMAND_DEFS)) {
    const filepath = path.join(promptDir, `${name}.prompt.md`);
    if (!fs.existsSync(filepath)) {
      const content = `---\ndescription: "${def.description}"\nmode: "agent"\n---\n\n${def.body}\n`;
      fs.writeFileSync(filepath, content);
      written.push(`.github/prompts/${name}.prompt.md`);
    }
  }
  return written;
}

/** Write Windsurf workflow files to .windsurf/workflows/. */
function writeWindsurfWorkflowFiles(cwd: string): string[] {
  const written: string[] = [];
  const workflowDir = path.join(cwd, ".windsurf", "workflows");
  fs.mkdirSync(workflowDir, { recursive: true });
  for (const [name, def] of Object.entries(SYNAPSE_COMMAND_DEFS)) {
    const filepath = path.join(workflowDir, `${name}.md`);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, `${def.body}\n`);
      written.push(`.windsurf/workflows/${name}.md`);
    }
  }
  return written;
}

// --- Per-editor writers ---

function writeGenericMcp(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  writeMcpJson(path.join(cwd, ".mcp.json"), apiKey);
  written.push(".mcp.json");
  ensureGitignore(cwd, ".mcp.json");
  return written;
}

function writeCursorLocal(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  const configDir = path.join(cwd, ".cursor");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp.json"), apiKey);
  written.push(".cursor/mcp.json");
  if (appendInstructions(path.join(cwd, ".cursorrules"))) {
    written.push(".cursorrules");
  }
  written.push(...writeCursorCommandFiles(path.join(cwd, ".cursor"), ".cursor/"));
  return written;
}

function writeCursorGlobal(apiKey: string): string[] {
  const written: string[] = [];
  const globalMcp = path.join(os.homedir(), ".cursor", "mcp.json");
  writeMcpJson(globalMcp, apiKey);
  written.push("~/.cursor/mcp.json");
  written.push(...writeCursorCommandFiles(path.join(os.homedir(), ".cursor"), "~/.cursor/"));
  return written;
}

function writeWindsurfLocal(apiKey: string, home: string, cwd: string): string[] {
  const written: string[] = [];
  const configDir = path.join(home, ".codeium", "windsurf");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp_config.json"), apiKey);
  written.push("~/.codeium/windsurf/mcp_config.json");
  if (appendInstructions(path.join(cwd, ".windsurfrules"))) {
    written.push(".windsurfrules");
  }
  written.push(...writeWindsurfWorkflowFiles(cwd));
  return written;
}

function writeWindsurfGlobal(apiKey: string, home: string): string[] {
  const written: string[] = [];
  const configDir = path.join(home, ".codeium", "windsurf");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp_config.json"), apiKey);
  written.push("~/.codeium/windsurf/mcp_config.json");
  return written;
}

function writeVSCodeLocal(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  writeJsonSafe(path.join(cwd, ".vscode", "settings.json"), (settings) => {
    if (!settings.mcp) settings.mcp = {};
    const mcp = settings.mcp as Record<string, unknown>;
    if (!mcp.servers) mcp.servers = {};
    (mcp.servers as Record<string, unknown>).synapse = synapseMcpServer(apiKey);
  });
  written.push(".vscode/settings.json");
  const ghDir = path.join(cwd, ".github");
  fs.mkdirSync(ghDir, { recursive: true });
  if (appendInstructions(path.join(ghDir, "copilot-instructions.md"))) {
    written.push(".github/copilot-instructions.md");
  }
  written.push(...writeVSCodePromptFiles(cwd));
  return written;
}

function writeVSCodeGlobal(apiKey: string): string[] {
  const written: string[] = [];
  const settingsPath = path.join(globalConfigDir(), "Code", "User", "settings.json");
  if (fs.existsSync(path.dirname(settingsPath))) {
    writeJsonSafe(settingsPath, (settings) => {
      if (!settings.mcp) settings.mcp = {};
      const mcp = settings.mcp as Record<string, unknown>;
      if (!mcp.servers) mcp.servers = {};
      (mcp.servers as Record<string, unknown>).synapse = synapseMcpServer(apiKey);
    });
    written.push("VS Code user settings.json");
  }
  return written;
}

function writeClaudeCodeLocal(apiKey: string, home: string, cwd: string): string[] {
  const written: string[] = [];
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  if (appendInstructions(path.join(claudeDir, "CLAUDE.md"))) {
    written.push("~/.claude/CLAUDE.md");
  }
  const cmdDir = path.join(claudeDir, "commands", "synapse");
  fs.mkdirSync(cmdDir, { recursive: true });
  const commands: Record<string, string> = {
    "search.md": `Search the Synapse workspace. The search query is: $ARGUMENTS\n\nUses semantic search — understands meaning, not just keywords.\n\nRun \`mcp__synapse__search({ query: "$ARGUMENTS" })\` and display results. If not connected, say "Not connected."\n`,
    "tree.md": `Show the full Synapse workspace file tree.\n\nRun \`mcp__synapse__tree()\` and display the tree. If not connected, say "Not connected."\n`,
    "sync.md": `Sync project context to Synapse.\n\n1. Run \`mcp__synapse__tree()\` to see existing workspace structure\n2. Determine the project name from the repo/codebase\n3. Run \`mcp__synapse__ls({ path: "projects/<name>" })\` to check existing context\n4. Summarize recent git changes\n5. Write overview and recent changes under the project's directory\n6. Place files where they fit the existing structure\n`,
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

function writeClaudeCodeGlobal(apiKey: string, home: string): string[] {
  const written: string[] = [];
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  if (appendInstructions(path.join(claudeDir, "CLAUDE.md"))) {
    written.push("~/.claude/CLAUDE.md");
  }

  // Write global MCP config for Claude Code
  const mcpJsonPath = path.join(claudeDir, ".mcp.json");
  writeMcpJson(mcpJsonPath, apiKey);
  written.push("~/.claude/.mcp.json");

  const cmdDir = path.join(claudeDir, "commands", "synapse");
  fs.mkdirSync(cmdDir, { recursive: true });
  const commands: Record<string, string> = {
    "search.md": `Search the Synapse workspace. The search query is: $ARGUMENTS\n\nUses semantic search — understands meaning, not just keywords.\n\nRun \`mcp__synapse__search({ query: "$ARGUMENTS" })\` and display results. If not connected, say "Not connected."\n`,
    "tree.md": `Show the full Synapse workspace file tree.\n\nRun \`mcp__synapse__tree()\` and display the tree. If not connected, say "Not connected."\n`,
    "sync.md": `Sync project context to Synapse.\n\n1. Run \`mcp__synapse__tree()\` to see existing workspace structure\n2. Determine the project name from the repo/codebase\n3. Run \`mcp__synapse__ls({ path: "projects/<name>" })\` to check existing context\n4. Summarize recent git changes\n5. Write overview and recent changes under the project's directory\n6. Place files where they fit the existing structure\n`,
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
  return written;
}

// --- Public API ---

export function detectEditors(scope: SetupScope): EditorInfo[] {
  const home = os.homedir();
  const cwd = process.cwd();

  if (scope === "global") {
    return [
      {
        id: "claude-code",
        name: "Claude Code",
        detected: fs.existsSync(path.join(home, ".claude")),
        hint: "~/.claude/CLAUDE.md + commands",
        write: (apiKey) => writeClaudeCodeGlobal(apiKey, home),
      },
      {
        id: "cursor",
        name: "Cursor",
        detected: fs.existsSync(path.join(home, ".cursor")),
        hint: "~/.cursor/mcp.json + commands",
        write: (apiKey) => writeCursorGlobal(apiKey),
      },
      {
        id: "windsurf",
        name: "Windsurf",
        detected: fs.existsSync(path.join(home, ".codeium")),
        hint: "~/.codeium/windsurf/mcp_config.json",
        write: (apiKey) => writeWindsurfGlobal(apiKey, home),
      },
      {
        id: "vscode",
        name: "VS Code",
        detected: fs.existsSync(path.join(globalConfigDir(), "Code", "User")),
        hint: "VS Code user settings.json",
        write: (apiKey) => writeVSCodeGlobal(apiKey),
      },
    ];
  }

  return [
    {
      id: "claude-code",
      name: "Claude Code",
      detected: fs.existsSync(path.join(home, ".claude")),
      hint: "~/.claude/CLAUDE.md + .mcp.json",
      write: (apiKey) => writeClaudeCodeLocal(apiKey, home, cwd),
    },
    {
      id: "cursor",
      name: "Cursor",
      detected: fs.existsSync(path.join(cwd, ".cursor")) || fs.existsSync(path.join(cwd, ".cursorrules")),
      hint: ".cursor/mcp.json + commands + .cursorrules",
      write: (apiKey) => writeCursorLocal(apiKey, cwd),
    },
    {
      id: "windsurf",
      name: "Windsurf",
      detected: fs.existsSync(path.join(home, ".codeium")),
      hint: "mcp_config + workflows + .windsurfrules",
      write: (apiKey) => writeWindsurfLocal(apiKey, home, cwd),
    },
    {
      id: "vscode",
      name: "VS Code",
      detected: fs.existsSync(path.join(cwd, ".vscode")),
      hint: ".vscode/settings.json + prompts + copilot-instructions",
      write: (apiKey) => writeVSCodeLocal(apiKey, cwd),
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

export interface ExistingSetup {
  configured: boolean;
  locations: string[];
  /** All unique API keys found across config files (first = local, last = global). */
  apiKeys: string[];
}

/** Extract SYNAPSE_API_KEY from a JSON MCP config file. */
function extractApiKey(filePath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const synapse = parsed?.mcpServers?.synapse;
    return synapse?.env?.SYNAPSE_API_KEY ?? null;
  } catch {
    return null;
  }
}

/** Check if Synapse is already configured in any local or global config. */
export function detectExistingSetup(): ExistingSetup {
  const home = os.homedir();
  const cwd = process.cwd();
  const locations: string[] = [];
  const apiKeySet = new Set<string>();

  // Check MCP JSON files — collect ALL unique API keys (local first, global last)
  const mcpFiles: [string, string][] = [
    [path.join(cwd, ".mcp.json"), ".mcp.json"],
    [path.join(cwd, ".cursor", "mcp.json"), ".cursor/mcp.json"],
    [path.join(home, ".cursor", "mcp.json"), "~/.cursor/mcp.json"],
    [path.join(home, ".claude", ".mcp.json"), "~/.claude/.mcp.json"],
    [path.join(home, ".codeium", "windsurf", "mcp_config.json"), "~/.codeium/windsurf/mcp_config.json"],
  ];

  for (const [filePath, label] of mcpFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (content.includes("synapsesync-mcp")) {
          locations.push(label);
          const key = extractApiKey(filePath);
          if (key) apiKeySet.add(key);
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Check non-MCP files (CLAUDE.md — has instructions but no API key)
  const claudeMd = path.join(home, ".claude", "CLAUDE.md");
  if (fs.existsSync(claudeMd)) {
    try {
      const content = fs.readFileSync(claudeMd, "utf-8");
      if (content.includes("Synapse")) locations.push("~/.claude/CLAUDE.md");
    } catch {
      /* ignore */
    }
  }

  return { configured: locations.length > 0, locations, apiKeys: [...apiKeySet] };
}

/** Write configs for selected editors. Continues on per-editor failure. */
export function writeEditorConfigs(editors: EditorInfo[], apiKey: string): WriteResult {
  const written: string[] = [];
  const errors: { editor: string; error: string }[] = [];
  for (const editor of editors) {
    try {
      written.push(...editor.write(apiKey));
    } catch (err) {
      errors.push({ editor: editor.name, error: (err as Error).message });
    }
  }
  return { written: [...new Set(written)], errors };
}

export function writeAllDetected(apiKey: string, scope: SetupScope = "local"): WriteResult {
  return writeEditorConfigs(
    detectEditors(scope).filter((e) => e.detected),
    apiKey,
  );
}
