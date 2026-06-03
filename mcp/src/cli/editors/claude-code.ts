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
  // The filesystem-style MCP tools (tree/ls/search/rm/list_conversations/
  // load_conversation/sync_conversation) were removed in mcp v1.1 (see
  // mcp/src/index.ts header comment). The slash commands that called them
  // were therefore dead and have been purged. Only `insights.md` survives —
  // it uses the still-extant list_insights/save_insight MCP tools. The
  // CLI-shelling slash commands (handoff/focus/issue/status/doctor/invite/
  // whoami/tree) are installed by installSlashCommands() in init.ts.
  const commands: Record<string, string> = {
    "insights.md":
      "List or save insights for the current project.\n\nUsage: $ARGUMENTS can be empty (list all), a type filter, or a new insight to save.\n\n1. Identify the project from the working directory name or git remote.\n2. If $ARGUMENTS is empty or a type name (decision/learning/preference/architecture/action_item), call `mcp__synapse__list_insights()` with the project name and optional type filter.\n3. If $ARGUMENTS describes something to save, call `mcp__synapse__save_insight()` with the project name, appropriate type, a concise summary, and optional detail.\n4. Display results clearly — for listings show type badges, summaries, and dates.\n",
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

  // Write user-scoped MCP config — Claude Code reads mcpServers from ~/.claude.json
  const mcpJsonPath = path.join(home, ".claude.json");
  writeMcpJson(mcpJsonPath, apiKey);
  written.push("~/.claude.json");

  const cmdDir = path.join(claudeDir, "commands", "synapse");
  fs.mkdirSync(cmdDir, { recursive: true });
  // The filesystem-style MCP tools (tree/ls/search/rm/list_conversations/
  // load_conversation/sync_conversation) were removed in mcp v1.1 (see
  // mcp/src/index.ts header comment). The slash commands that called them
  // were therefore dead and have been purged. Only `insights.md` survives —
  // it uses the still-extant list_insights/save_insight MCP tools. The
  // CLI-shelling slash commands (handoff/focus/issue/status/doctor/invite/
  // whoami/tree) are installed by installSlashCommands() in init.ts.
  const commands: Record<string, string> = {
    "insights.md":
      "List or save insights for the current project.\n\nUsage: $ARGUMENTS can be empty (list all), a type filter, or a new insight to save.\n\n1. Identify the project from the working directory name or git remote.\n2. If $ARGUMENTS is empty or a type name (decision/learning/preference/architecture/action_item), call `mcp__synapse__list_insights()` with the project name and optional type filter.\n3. If $ARGUMENTS describes something to save, call `mcp__synapse__save_insight()` with the project name, appropriate type, a concise summary, and optional detail.\n4. Display results clearly — for listings show type badges, summaries, and dates.\n",
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
