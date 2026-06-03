import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeServiceFile } from "../capture/os-service.js";

interface InitArgs {
  api_key: string;
  skip_service?: boolean;
}

const HOOK_BIN = "synapse";

interface HookBlock {
  matcher?: string;
  hooks: Array<{ type: "command"; command: string }>;
}

const HOOK_DEFS: Record<string, { command: string; matcher?: string }> = {
  SessionStart: { command: `${HOOK_BIN} hook session-start` },
  UserPromptSubmit: { command: `${HOOK_BIN} hook user-prompt-submit` },
  PostToolUse: {
    command: `${HOOK_BIN} hook post-tool-use`,
    matcher: "Bash|Edit|Write|MultiEdit|TaskCreate|TaskUpdate|Agent",
  },
  PreCompact: { command: `${HOOK_BIN} hook pre-compact` },
  SessionEnd: { command: `${HOOK_BIN} hook session-end` },
  SubagentStop: { command: `${HOOK_BIN} hook subagent-stop` },
};

export async function runInit(a: InitArgs): Promise<void> {
  installHooks();
  writeConfig(a.api_key);
  if (!a.skip_service) {
    const svc = writeServiceFile();
    console.log(`[synapse init] OS service registered: ${svc.path}`);
  }
}

interface Settings {
  hooks?: Record<string, HookBlock[]>;
}

function installHooks(): void {
  const settingsPath = path.join(os.homedir(), ".claude/settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings: Settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf-8")) : {};
  settings.hooks ??= {};

  for (const [event, def] of Object.entries(HOOK_DEFS)) {
    settings.hooks[event] ??= [];
    const subcommand = def.command.split(" ").slice(-1)[0];
    const already = JSON.stringify(settings.hooks[event]).includes(`${HOOK_BIN} hook ${subcommand}`);
    if (already) continue;
    const block: HookBlock = { hooks: [{ type: "command", command: def.command }] };
    if (def.matcher) block.matcher = def.matcher;
    settings.hooks[event].push(block);
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

interface SynapseConfig {
  api_key?: string;
  daemon?: { ai_enabled: boolean; monthly_budget_usd: number; model: string };
}

function writeConfig(api_key: string): void {
  const dir = path.join(os.homedir(), ".synapse");
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing: SynapseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  existing.api_key = api_key;
  existing.daemon ??= { ai_enabled: false, monthly_budget_usd: 5, model: "haiku" };
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
