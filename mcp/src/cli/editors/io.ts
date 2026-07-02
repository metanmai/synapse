import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSynapseMcpCommand } from "../util/mcp-command.js";

// The MCP filesystem-style tools (tree/ls/search/rm/read/write/history/
// list_conversations/load_conversation/sync_conversation) were removed in
// mcp v1.1 (see header comment in mcp/src/index.ts). The instructions blob
// no longer advertises them, and SYNAPSE_COMMAND_DEFS is reduced to the
// commands whose underlying tools still exist.
export const SYNAPSE_INSTRUCTIONS = `# Synapse — Shared Context Layer

You have access to a Synapse MCP server — a cross-session insight store.

## Available Tools

- save_insight — Save a decision, learning, preference, architecture note, or action item
- list_insights — Browse saved insights, optionally filtered by type

## Insights

When something worth remembering comes up during a session, save it as an insight:
- **decision** — A choice that was made and why (e.g. "Chose Postgres over DynamoDB because we need complex joins")
- **learning** — Something discovered or debugged (e.g. "Supabase RLS policies don't apply to service role keys")
- **preference** — A user or team preference (e.g. "User prefers functional components over class components")
- **architecture** — A structural note (e.g. "Auth tokens flow: frontend cookie → server load → backend Bearer header")
- **action_item** — Something to follow up on (e.g. "Add rate limiting to the import endpoint before launch")

Save insights proactively — don't wait to be asked. If you make a decision, learn something non-obvious, or notice a pattern, save it. Use \`list_insights\` to browse what's already known about the project before adding new entries.
`;

export interface CommandDef {
  description: string;
  body: string;
}

export const SYNAPSE_COMMAND_DEFS: Record<string, CommandDef> = {
  "synapse-insights": {
    description: "List or save insights for the current project",
    body: 'List or save insights for the current project.\n\nUsage: $ARGUMENTS can be empty (list all), a type filter (e.g. "decisions"), or a new insight to save.\n\n1. Determine the current project name from the repo/codebase\n2. If $ARGUMENTS is empty or a type name (decision/learning/preference/architecture/action_item), use the Synapse MCP `list_insights` tool to show existing insights, optionally filtered by type\n3. If $ARGUMENTS describes something to save, use the Synapse MCP `save_insight` tool with the appropriate type, a concise summary, and optional detail\n4. Display results clearly — for listings show type badges, summaries, and dates',
  },
};

export function synapseMcpServer(apiKey: string): Record<string, unknown> {
  return resolveSynapseMcpCommand(apiKey) as unknown as Record<string, unknown>;
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

/** Remove the "synapse" key from an MCP JSON config. Returns true if the file was modified. */
export function removeSynapseFromMcpJson(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    let changed = false;

    const strip = (obj: Record<string, unknown>, key: string) => Reflect.deleteProperty(obj, key);

    for (const key of ["mcpServers", "servers"]) {
      if (parsed?.[key]?.synapse) {
        strip(parsed[key], "synapse");
        if (Object.keys(parsed[key]).length === 0) strip(parsed, key);
        changed = true;
      }
    }
    if (parsed?.mcp?.servers?.synapse) {
      strip(parsed.mcp.servers, "synapse");
      if (Object.keys(parsed.mcp.servers).length === 0) strip(parsed.mcp, "servers");
      if (Object.keys(parsed.mcp).length === 0) strip(parsed, "mcp");
      changed = true;
    }

    if (changed) {
      if (Object.keys(parsed).length === 0) {
        fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
      }
    }
    return changed;
  } catch {
    return false;
  }
}

/** Remove the Synapse instructions block from an instructions file. Returns true if modified. */
export function removeInstructions(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes("# Synapse")) return false;
  // Remove the Synapse section (from "# Synapse" header to end, or to next top-level heading)
  const cleaned = content.replace(/\n*# Synapse — Shared Context Layer[\s\S]*$/, "").trimEnd();
  if (cleaned === content) return false;
  if (cleaned.length === 0) {
    fs.unlinkSync(filePath);
  } else {
    fs.writeFileSync(filePath, `${cleaned}\n`);
  }
  return true;
}

/** Recursively remove a directory if it exists. Returns true if deleted. */
export function removeDirIfExists(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  fs.rmSync(dirPath, { recursive: true, force: true });
  return true;
}
