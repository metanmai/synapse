import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { synapseRoot } from "../capture/handoff-paths.js";
import { writeServiceFile } from "../capture/os-service.js";
import { type MeResponse, fetchMe } from "./api.js";
// Namespace import so vi.spyOn(editorIo, "ensureGitignore") in init.test.ts
// intercepts the call site (ESM bindings are immutable from the importer's
// perspective when destructured).
import * as editorIo from "./editors/io.js";
import { PROXY_FALLBACK_WARNING, probeNpmRegistry, resolveSynapseMcpCommand } from "./util/mcp-command.js";

interface InitArgs {
  api_key: string;
  skip_service?: boolean;
}

interface HookBlock {
  matcher?: string;
  hooks: Array<{ type: "command"; command: string }>;
}

// Absolute paths to the running node + CLI entry. Used so installed hooks and
// slash commands keep working even when `synapse` is not on PATH (the default,
// since the package is not installed globally by `synapse init`).
function resolveBin(): string {
  const nodePath = process.execPath;
  let cliPath = process.argv[1] ?? "";
  try {
    cliPath = fs.realpathSync(cliPath);
  } catch {
    // argv[1] not a real file (test runner, ts-node, etc) — fall through with raw value
  }
  return `"${nodePath}" "${cliPath}"`;
}

const HOOK_SUBCOMMANDS = [
  "session-start",
  "user-prompt-submit",
  "post-tool-use",
  "pre-compact",
  "session-end",
  "subagent-stop",
] as const;

function hookDefs(bin: string): Record<string, { command: string; matcher?: string }> {
  return {
    SessionStart: { command: `${bin} hook session-start` },
    UserPromptSubmit: { command: `${bin} hook user-prompt-submit` },
    PostToolUse: {
      command: `${bin} hook post-tool-use`,
      matcher: "Bash|Edit|Write|MultiEdit|TaskCreate|TaskUpdate|Agent",
    },
    PreCompact: { command: `${bin} hook pre-compact` },
    SessionEnd: { command: `${bin} hook session-end` },
    SubagentStop: { command: `${bin} hook subagent-stop` },
  };
}

export async function runInit(a: InitArgs): Promise<void> {
  // Phase 2 (IDENT-01, D-05): fail-fast on /me failure BEFORE any disk write.
  // If the backend rejects the api_key (401) or we can't reach it (network),
  // refuse to write a half-configured config.json. Caller (the wizard or
  // direct CLI invocation) surfaces the error via process.exit(1).
  const identity = await fetchMe(a.api_key);

  const bin = resolveBin();
  installHooks(bin);
  installSlashCommands(bin);
  writeConfig(a.api_key, identity);

  // BUG-04: write project-local `.mcp.json` so Claude Code in this cwd
  // can reach the Synapse MCP server. `writeMcpJson` is merge-aware (preserves
  // other server entries) and backs up unparseable JSON. `ensureGitignore`
  // is mandatory — `.mcp.json` carries SYNAPSE_API_KEY in `env`.
  const cwd = process.cwd();
  const mcpPath = path.join(cwd, ".mcp.json");
  editorIo.writeMcpJson(mcpPath, a.api_key);
  editorIo.ensureGitignore(cwd, ".mcp.json");

  if (!a.skip_service) {
    const svc = writeServiceFile();
    console.log(`[synapse init] OS service registered: ${svc.path}`);
  }

  // BUG-03 wizard outro: if the resolver fell through to `npx synapsesync`
  // AND the npm registry is unreachable from here, warn the user with the
  // single-source-of-truth string. Quiet no-op on a clean network.
  const resolved = resolveSynapseMcpCommand(a.api_key);
  if (resolved.command === "npx") {
    const reachable = await probeNpmRegistry();
    if (!reachable) {
      console.warn(`[synapse init] ${PROXY_FALLBACK_WARNING}`);
    }
  }
}

function slashCommands(bin: string): Record<string, string> {
  return {
    "handoff.md": `---
name: synapse-handoff
description: Record an explicit next-step handoff for whoever picks up this work next.
---

Run \`${bin} handoff "$ARGUMENTS"\` via the Bash tool. After it completes, briefly confirm what you recorded.
`,
    "focus.md": `---
name: synapse-focus
description: Set the current focus for this work session.
---

Run \`${bin} set-focus "$ARGUMENTS"\` via the Bash tool. Confirm what was set.
`,
    "issue.md": `---
name: synapse-issue
description: Create, resolve, or supersede an issue. Args: create|resolve|supersede [kind] <title|id> [extra]
---

Parse \`$ARGUMENTS\` to determine the action:
- "create <kind?> <title>" — run \`${bin} issue create --kind <decision|question> --title "<title>"\`. If kind is missing, ask the user which kind it should be.
- "resolve <id> <resolution>" — run \`${bin} issue resolve <id> "<resolution>"\`.
- "supersede <id> --by <new_id>" — run \`${bin} issue supersede <id> --by <new_id>\`.

Confirm the action taken.
`,
    "status.md": `---
name: synapse-status
description: One-line health check of the Synapse daemon.
---

Run \`${bin} status\` via the Bash tool and report the output.
`,
    "doctor.md": `---
name: synapse-doctor
description: Detailed Synapse daemon diagnostics.
---

Run \`${bin} doctor\` via the Bash tool and report the output.
`,
    "invite.md": `---
name: synapse-invite
description: Invite a teammate to this project. Args: <email>
---

Run \`${bin} invite "$ARGUMENTS"\` via the Bash tool. Report the join URL.
`,
    "whoami.md": `---
name: synapse-whoami
description: Show current Synapse account info.
---

Run \`${bin} whoami\` via the Bash tool and report the output.
`,
    "tree.md": `---
name: synapse-tree
description: Show the Synapse workspace file tree for the first project.
---

Run \`${bin} tree\` via the Bash tool and report the output.
`,
  };
}

function installSlashCommands(bin: string): void {
  const dir = path.join(os.homedir(), ".claude/commands/synapse");
  fs.mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(slashCommands(bin))) {
    // Always rewrite — slash commands are tightly coupled to the CLI argv and
    // contain absolute bin paths that may have shifted since the last install.
    fs.writeFileSync(path.join(dir, filename), content);
  }
}

interface Settings {
  hooks?: Record<string, HookBlock[]>;
}

function installHooks(bin: string): void {
  const settingsPath = path.join(os.homedir(), ".claude/settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings: Settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf-8")) : {};
  settings.hooks ??= {};

  // Migrate: drop any pre-existing synapse hook entries (any bin form) so we
  // never end up with both a stale `synapse hook ...` entry and the new
  // absolute-path one firing in parallel.
  for (const [event, blocks] of Object.entries(settings.hooks)) {
    settings.hooks[event] = (blocks ?? []).filter((block) => {
      const cmd = block.hooks?.[0]?.command ?? "";
      return !HOOK_SUBCOMMANDS.some((sub) => cmd.endsWith(` hook ${sub}`));
    });
  }

  for (const [event, def] of Object.entries(hookDefs(bin))) {
    settings.hooks[event] ??= [];
    const block: HookBlock = { hooks: [{ type: "command", command: def.command }] };
    if (def.matcher) block.matcher = def.matcher;
    settings.hooks[event].push(block);
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

interface SynapseConfig {
  api_key?: string;
  user_id?: string;
  email?: string;
}

function writeConfig(api_key: string, identity: MeResponse): void {
  // Honor SYNAPSE_HOME (via synapseRoot) so init + daemon agree on where the
  // config lives. In production both resolve to ~/.synapse; in tests SYNAPSE_HOME
  // routes both to the isolated tmpdir.
  // Phase 2 (D-01): persist user_id + email from /me so the daemon resolves the
  // real public.users.id on every hook capture instead of the "default" placeholder.
  const dir = synapseRoot();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing: SynapseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  existing.api_key = api_key;
  existing.user_id = identity.user_id;
  existing.email = identity.email;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
