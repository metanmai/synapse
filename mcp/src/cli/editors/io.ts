import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYNAPSE_INSTRUCTIONS = `# Synapse — Shared Context Layer

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

export interface CommandDef {
  description: string;
  body: string;
}

export const SYNAPSE_COMMAND_DEFS: Record<string, CommandDef> = {
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

export function synapseMcpServer(apiKey: string): Record<string, unknown> {
  return { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } };
}

export function writeMcpJson(filePath: string, apiKey: string): void {
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

export function appendInstructions(filePath: string): boolean {
  let content = "";
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf-8");
  }
  if (content.includes("Synapse")) return false;
  fs.appendFileSync(filePath, `\n${SYNAPSE_INSTRUCTIONS}`);
  return true;
}

export function ensureGitignore(cwd: string, entry: string): void {
  const gitignore = path.join(cwd, ".gitignore");
  let content = "";
  if (fs.existsSync(gitignore)) {
    content = fs.readFileSync(gitignore, "utf-8");
  }
  if (!content.includes(entry)) {
    fs.appendFileSync(gitignore, `${content.length > 0 && !content.endsWith("\n") ? "\n" : ""}${entry}\n`);
  }
}

export function writeJsonSafe(filePath: string, updater: (obj: Record<string, unknown>) => void): void {
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

export function globalConfigDir(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}
