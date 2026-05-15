import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeClaudeCodeGlobal, writeClaudeCodeLocal } from "./claude-code.js";
import { writeCursorGlobal, writeCursorLocal } from "./cursor.js";
import { ensureGitignore, globalConfigDir, writeMcpJson } from "./io.js";
import { writeVSCodeGlobal, writeVSCodeLocal } from "./vscode.js";
import { writeWindsurfGlobal, writeWindsurfLocal } from "./windsurf.js";

export type SetupScope = "local" | "global";

export interface EditorInfo {
  id: string;
  name: string;
  detected: boolean;
  hint: string;
  write: (apiKey: string) => string[];
}

function writeGenericMcp(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  writeMcpJson(path.join(cwd, ".mcp.json"), apiKey);
  written.push(".mcp.json");
  ensureGitignore(cwd, ".mcp.json");
  return written;
}

export function detectEditors(scope: SetupScope): EditorInfo[] {
  const home = os.homedir();
  const cwd = process.cwd();

  if (scope === "global") {
    return [
      {
        id: "claude-code",
        name: "Claude Code",
        detected: fs.existsSync(path.join(home, ".claude")),
        hint: "~/.claude.json + CLAUDE.md + commands",
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

export type LocationStatus = "has_key" | "no_key" | "instructions_only";

export interface ConfigLocation {
  label: string;
  filePath: string;
  status: LocationStatus;
  apiKey: string | null;
}

export interface ExistingSetup {
  configured: boolean;
  locations: ConfigLocation[];
  /** All unique API keys found across config files (first = local, last = global). */
  apiKeys: string[];
}

/** Extract SYNAPSE_API_KEY from a JSON MCP config file. */
function extractApiKey(filePath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    // Claude Code / Cursor / Windsurf use mcpServers, VS Code uses mcp.servers or servers
    const synapse = parsed?.mcpServers?.synapse ?? parsed?.mcp?.servers?.synapse ?? parsed?.servers?.synapse;
    return synapse?.env?.SYNAPSE_API_KEY ?? null;
  } catch {
    return null;
  }
}

/** Check if Synapse is already configured in any local or global config. */
export function detectExistingSetup(): ExistingSetup {
  const home = os.homedir();
  const cwd = process.cwd();
  const locations: ConfigLocation[] = [];
  const apiKeySet = new Set<string>();

  // Check MCP JSON files — collect ALL unique API keys (local first, global last)
  const mcpFiles: [string, string][] = [
    [path.join(cwd, ".mcp.json"), ".mcp.json"],
    [path.join(cwd, ".vscode", "mcp.json"), ".vscode/mcp.json"],
    [path.join(cwd, ".cursor", "mcp.json"), ".cursor/mcp.json"],
    [path.join(home, ".cursor", "mcp.json"), "~/.cursor/mcp.json"],
    [path.join(home, ".claude.json"), "~/.claude.json"],
    [path.join(home, ".claude", ".mcp.json"), "~/.claude/.mcp.json"],
    [path.join(home, ".codeium", "windsurf", "mcp_config.json"), "~/.codeium/windsurf/mcp_config.json"],
  ];

  for (const [filePath, label] of mcpFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (content.includes("synapsesync-mcp") || content.includes("synapse")) {
          const key = extractApiKey(filePath);
          if (key) apiKeySet.add(key);
          locations.push({
            label,
            filePath,
            status: key ? "has_key" : "no_key",
            apiKey: key,
          });
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
      if (content.includes("Synapse")) {
        locations.push({
          label: "~/.claude/CLAUDE.md",
          filePath: claudeMd,
          status: "instructions_only",
          apiKey: null,
        });
      }
    } catch {
      /* ignore */
    }
  }

  return { configured: locations.length > 0, locations, apiKeys: [...apiKeySet] };
}
