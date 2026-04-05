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
    "list-convos.md":
      'List conversations synced to Synapse for a project.\n\n1. If not connected, say "Not connected. Run `/synapse:init`."\n2. Identify the project from the working directory name or git remote. If multiple projects exist, ask which one.\n3. Call `mcp__synapse__list_conversations()` with the project name.\n4. Display the conversations as a table with title, message count, status, and last updated date.\n5. If $ARGUMENTS contains "archived", filter to archived conversations. Otherwise show active ones.\n6. Tell the user: "To load a conversation, run `/synapse:load-convo <id>`"\n',
    "load-convo.md":
      'Load a conversation from Synapse to continue it in this session.\n\n1. If not connected, say "Not connected. Run `/synapse:init`."\n2. If a conversation ID is provided as $ARGUMENTS, load that conversation directly.\n3. If no ID is provided:\n   - Identify the project from the working directory name or git remote.\n   - Call `mcp__synapse__list_conversations()` to show available conversations.\n   - Show the list with titles, message counts, and last updated dates.\n   - Ask the user which conversation to load.\n4. Call `mcp__synapse__load_conversation()` with the project and conversation ID.\n5. Display a concise summary of the conversation arc, then the last 2-3 exchanges in full.\n6. Say: "Conversation loaded. I have the full context — what would you like to continue with?"\n',
    "sync-convo.md":
      'Sync the current conversation to Synapse so it can be resumed in another session or agent.\n\n1. If not connected, say "Not connected. Run `/synapse:init`."\n2. Identify the project from the working directory name or git remote.\n3. Build a summary:\n   - Title: derive from the main topic (under 60 chars)\n   - System prompt: extract from the conversation context\n   - Working context: repo name, branch, editor, key project details\n   - Messages: capture key exchanges. Summarize intermediate steps but keep full detail for decisions, code changes, and outcomes. Include sourceAgent and sourceModel where known.\n4. Call `mcp__synapse__sync_conversation()` with project, title, systemPrompt, fidelity "summary", workingContext, and messages.\n5. Show the conversation ID and tell the user how to load it.\n\nIf $ARGUMENTS is a conversation ID, append new messages to that existing conversation instead of creating a new one.\n',
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
  const commands: Record<string, string> = {
    "search.md": `Search the Synapse workspace. The search query is: $ARGUMENTS\n\nUses semantic search — understands meaning, not just keywords.\n\nRun \`mcp__synapse__search({ query: "$ARGUMENTS" })\` and display results. If not connected, say "Not connected."\n`,
    "tree.md": `Show the full Synapse workspace file tree.\n\nRun \`mcp__synapse__tree()\` and display the tree. If not connected, say "Not connected."\n`,
    "sync.md": `Sync project context to Synapse.\n\n1. Run \`mcp__synapse__tree()\` to see existing workspace structure\n2. Determine the project name from the repo/codebase\n3. Run \`mcp__synapse__ls({ path: "projects/<name>" })\` to check existing context\n4. Summarize recent git changes\n5. Write overview and recent changes under the project's directory\n6. Place files where they fit the existing structure\n`,
    "whoami.md": `Show current Synapse account info.\n\n1. Run \`mcp__synapse__ls()\` to verify connection\n2. Run \`mcp__synapse__tree()\` to count files\n3. Show: "Connected. Files: [count]."\n`,
    "clean.md":
      "Clean up the Synapse workspace — remove duplicates, test files, and stale entries.\n\n1. Run `mcp__synapse__tree()`\n2. Identify duplicates, test files, empty entries\n3. Confirm with user before deleting\n4. Delete confirmed entries with `mcp__synapse__rm()`\n",
    "list-convos.md":
      'List conversations synced to Synapse for a project.\n\n1. If not connected, say "Not connected. Run `/synapse:init`."\n2. Identify the project from the working directory name or git remote. If multiple projects exist, ask which one.\n3. Call `mcp__synapse__list_conversations()` with the project name.\n4. Display the conversations as a table with title, message count, status, and last updated date.\n5. If $ARGUMENTS contains "archived", filter to archived conversations. Otherwise show active ones.\n6. Tell the user: "To load a conversation, run `/synapse:load-convo <id>`"\n',
    "load-convo.md":
      'Load a conversation from Synapse to continue it in this session.\n\n1. If not connected, say "Not connected. Run `/synapse:init`."\n2. If a conversation ID is provided as $ARGUMENTS, load that conversation directly.\n3. If no ID is provided:\n   - Identify the project from the working directory name or git remote.\n   - Call `mcp__synapse__list_conversations()` to show available conversations.\n   - Show the list with titles, message counts, and last updated dates.\n   - Ask the user which conversation to load.\n4. Call `mcp__synapse__load_conversation()` with the project and conversation ID.\n5. Display a concise summary of the conversation arc, then the last 2-3 exchanges in full.\n6. Say: "Conversation loaded. I have the full context — what would you like to continue with?"\n',
    "sync-convo.md":
      'Sync the current conversation to Synapse so it can be resumed in another session or agent.\n\n1. If not connected, say "Not connected. Run `/synapse:init`."\n2. Identify the project from the working directory name or git remote.\n3. Build a summary:\n   - Title: derive from the main topic (under 60 chars)\n   - System prompt: extract from the conversation context\n   - Working context: repo name, branch, editor, key project details\n   - Messages: capture key exchanges. Summarize intermediate steps but keep full detail for decisions, code changes, and outcomes. Include sourceAgent and sourceModel where known.\n4. Call `mcp__synapse__sync_conversation()` with project, title, systemPrompt, fidelity "summary", workingContext, and messages.\n5. Show the conversation ID and tell the user how to load it.\n\nIf $ARGUMENTS is a conversation ID, append new messages to that existing conversation instead of creating a new one.\n',
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
