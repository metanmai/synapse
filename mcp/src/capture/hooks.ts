import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYNAPSE_DIR = path.join(os.homedir(), ".synapse");
const HOOK_MARKER = "capture-worker.js";

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

/** Resolve the absolute path to capture-worker.js from the compiled dist/ directory. */
function getWorkerPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-worker.js");
}

/** Build an idempotent bash command that starts the daemon if not already running. */
export function buildStartCommand(workerPath?: string): string {
  const worker = workerPath ?? getWorkerPath();
  const pidFile = path.join(SYNAPSE_DIR, "capture.pid");
  const logFile = path.join(SYNAPSE_DIR, "capture.log");

  return [
    `PID_FILE="${pidFile}"`,
    `if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then exit 0; fi`,
    `mkdir -p "${SYNAPSE_DIR}"`,
    `nohup node "${worker}" > "${logFile}" 2>&1 &`,
    `echo $! > "$PID_FILE"`,
  ].join("; ");
}

/** Read Claude Code settings from disk. Returns empty object if file doesn't exist. */
function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) return {};
  return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
}

/** Write Claude Code settings to disk, creating parent directories. */
function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Check if Synapse capture hooks are already installed. */
export function isInstalled(settingsPath?: string): boolean {
  const p = settingsPath ?? defaultSettingsPath();
  const settings = readSettings(p);
  const groups = settings.hooks?.SessionStart ?? [];
  return groups.some((g) => g.hooks.some((h) => h.command.includes(HOOK_MARKER)));
}

/** Install SessionStart hook into Claude Code settings. Returns the settings path used. */
export function installHooks(settingsPath?: string): {
  installed: boolean;
  settingsPath: string;
  alreadyInstalled: boolean;
} {
  const p = settingsPath ?? defaultSettingsPath();
  const settings = readSettings(p);

  if (!settings.hooks) settings.hooks = {};

  // Check if already installed
  const groups = settings.hooks.SessionStart ?? [];
  const already = groups.some((g) => g.hooks.some((h) => h.command.includes(HOOK_MARKER)));
  if (already) {
    return { installed: false, settingsPath: p, alreadyInstalled: true };
  }

  // Add SessionStart hook
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  settings.hooks.SessionStart.push({
    hooks: [
      {
        type: "command",
        command: buildStartCommand(),
        timeout: 10,
      },
    ],
  });

  writeSettings(p, settings);
  return { installed: true, settingsPath: p, alreadyInstalled: false };
}

/** Remove Synapse capture hooks from Claude Code settings. */
export function uninstallHooks(settingsPath?: string): {
  removed: boolean;
  settingsPath: string;
} {
  const p = settingsPath ?? defaultSettingsPath();
  if (!fs.existsSync(p)) return { removed: false, settingsPath: p };

  const settings = readSettings(p);
  if (!settings.hooks) return { removed: false, settingsPath: p };

  const groups = settings.hooks.SessionStart;
  if (!groups) return { removed: false, settingsPath: p };

  const filtered = groups.filter((g) => !g.hooks.some((h) => h.command.includes(HOOK_MARKER)));
  if (filtered.length === groups.length) return { removed: false, settingsPath: p };

  // Rebuild hooks without Synapse entries
  const { SessionStart: _, ...otherEvents } = settings.hooks;
  const newHooks = filtered.length > 0 ? { SessionStart: filtered, ...otherEvents } : otherEvents;

  // Rebuild settings — omit hooks entirely if empty
  const { hooks: __, ...restSettings } = settings;
  const output = Object.keys(newHooks).length > 0 ? { ...restSettings, hooks: newHooks } : restSettings;

  writeSettings(p, output as ClaudeSettings);
  return { removed: true, settingsPath: p };
}

function defaultSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}
