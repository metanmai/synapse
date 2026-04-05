import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYNAPSE_INSTRUCTIONS = `# Synapse — Shared Context Layer

You have access to a Synapse MCP server — a remote workspace for storing and retrieving context across sessions.

## Available Tools

### Context (filesystem-style)
- search — Semantic search across all files (finds by meaning, not just keywords)
- read — Read a file's content
- write — Create or update a file
- ls — List files in a directory
- tree — Show full directory tree
- history — View version history
- rm — Delete a file

### Insights (structured knowledge)
- save_insight — Save a decision, learning, preference, architecture note, or action item
- list_insights — Browse saved insights, optionally filtered by type

## How to Use
1. BEFORE writing anything, run tree() to see the existing workspace structure
2. BEFORE starting any task, search Synapse for existing context: search({ query: "topic" })
3. AFTER completing work, save context to the RIGHT location by following the existing structure:
   - Project-specific context (decisions, bugs, changelogs, architecture) → under the project's directory (e.g. projects/<name>/)
   - Cross-project decisions, research, retrospectives → root-level directories
   - Settings and configuration → settings/
   - Determine the project name from the repo, codebase, or conversation context — not from a hardcoded value

## Insights
When something worth remembering comes up during a session, save it as an insight:
- **decision** — A choice that was made and why (e.g. "Chose Postgres over DynamoDB because we need complex joins")
- **learning** — Something discovered or debugged (e.g. "Supabase RLS policies don't apply to service role keys")
- **preference** — A user or team preference (e.g. "User prefers functional components over class components")
- **architecture** — A structural note (e.g. "Auth tokens flow: frontend cookie → server load → backend Bearer header")
- **action_item** — Something to follow up on (e.g. "Add rate limiting to the import endpoint before launch")

Save insights proactively — don't wait to be asked. If you make a decision, learn something non-obvious, or notice a pattern, save it.

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
  "synapse-insights": {
    description: "List or save insights for the current project",
    body: "List or save insights for the current project.\n\nUsage: $ARGUMENTS can be empty (list all), a type filter (e.g. \"decisions\"), or a new insight to save.\n\n1. Determine the current project name from the repo/codebase\n2. If $ARGUMENTS is empty or a type name (decision/learning/preference/architecture/action_item), use the Synapse MCP `list_insights` tool to show existing insights, optionally filtered by type\n3. If $ARGUMENTS describes something to save, use the Synapse MCP `save_insight` tool with the appropriate type, a concise summary, and optional detail\n4. Display results clearly — for listings show type badges, summaries, and dates",
  },
  "synapse-conversations": {
    description: "List synced conversations in the current project",
    body: "List conversations synced to Synapse for the current project.\n\n1. Use the Synapse MCP `list_conversations` tool with the current project name\n2. Display each conversation with its title, message count, status, and last-updated date\n3. Show the conversation ID so the user can resume or load a specific one\n4. If no conversations exist, let the user know and suggest using `/synapse:save-conversation` to sync one",
  },
  "synapse-resume": {
    description: "Resume a conversation from another agent session",
    body: 'Resume a conversation that was synced from another agent or session.\n\nUsage: Provide a conversation ID or search term as $ARGUMENTS.\n\n1. If $ARGUMENTS looks like a UUID, use the Synapse MCP `load_conversation` tool with that ID and the current project name\n2. If $ARGUMENTS is a search term, first call `list_conversations` to find matching conversations, then let the user pick one\n3. Once loaded, display the conversation\'s system prompt, working context, and message history\n4. Tell the user: "Conversation loaded. I have the full context — you can continue where you left off."\n5. Adopt the conversation context (system prompt, working context) and continue naturally from the last message',
  },
  "synapse-save-conversation": {
    description: "Save the current conversation to Synapse for cross-agent sync",
    body: 'Save the current conversation to Synapse so it can be resumed in another agent or session.\n\n1. Determine the current project name from the repo/codebase\n2. Summarize the conversation so far — key topics discussed, decisions made, code changes, and current state\n3. Use the Synapse MCP `sync_conversation` tool with:\n   - The project name\n   - A descriptive title for the conversation\n   - The conversation messages (summarize tool calls, keep user/assistant messages)\n   - Working context: current branch, repo path, key files touched\n4. Display the conversation ID so the user can resume it later\n5. Suggest: "Use `/synapse:resume <ID>` in any agent to pick up where you left off."',
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
