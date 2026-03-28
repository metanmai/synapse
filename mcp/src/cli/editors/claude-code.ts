import fs from "node:fs";
import path from "node:path";
import { appendInstructions, ensureGitignore, writeMcpJson } from "./io.js";

function writeGenericMcp(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  writeMcpJson(path.join(cwd, ".mcp.json"), apiKey);
  written.push(".mcp.json");
  ensureGitignore(cwd, ".mcp.json");
  return written;
}

export function writeClaudeCodeLocal(apiKey: string, home: string, cwd: string): string[] {
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

export function writeClaudeCodeGlobal(apiKey: string, home: string): string[] {
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
