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
  installSlashCommands();
  writeConfig(a.api_key);
  if (!a.skip_service) {
    const svc = writeServiceFile();
    console.log(`[synapse init] OS service registered: ${svc.path}`);
  }
}

const SLASH_COMMANDS: Record<string, string> = {
  "handoff.md": `---
name: synapse-handoff
description: Record an explicit next-step handoff for whoever picks up this work next.
---

Run \`synapse handoff "$ARGUMENTS"\` via the Bash tool. After it completes, briefly confirm what you recorded.
`,
  "focus.md": `---
name: synapse-focus
description: Set the current focus for this work session.
---

Run \`synapse set-focus "$ARGUMENTS"\` via the Bash tool. Confirm what was set.
`,
  "issue.md": `---
name: synapse-issue
description: Create, resolve, or supersede an issue. Args: create|resolve|supersede [kind] <title|id> [extra]
---

Parse \`$ARGUMENTS\` to determine the action:
- "create <kind?> <title>" — run \`synapse issue create --kind <decision|question> --title "<title>"\`. If kind is missing, ask the user which kind it should be.
- "resolve <id> <resolution>" — run \`synapse issue resolve <id> "<resolution>"\`.
- "supersede <id> --by <new_id>" — run \`synapse issue supersede <id> --by <new_id>\`.

Confirm the action taken.
`,
  "status.md": `---
name: synapse-status
description: One-line health check of the Synapse daemon.
---

Run \`synapse status\` via the Bash tool and report the output.
`,
  "doctor.md": `---
name: synapse-doctor
description: Detailed Synapse daemon diagnostics.
---

Run \`synapse doctor\` via the Bash tool and report the output.
`,
  "invite.md": `---
name: synapse-invite
description: Invite a teammate to this project. Args: <email>
---

Run \`synapse invite "$ARGUMENTS"\` via the Bash tool. Report the join URL.
`,
};

function installSlashCommands(): void {
  const dir = path.join(os.homedir(), ".claude/commands/synapse");
  fs.mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(SLASH_COMMANDS)) {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content);
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
}

function writeConfig(api_key: string): void {
  const dir = path.join(os.homedir(), ".synapse");
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing: SynapseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  existing.api_key = api_key;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
