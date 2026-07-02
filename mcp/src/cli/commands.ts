import child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as clack from "@clack/prompts";
import { removeServiceFile, serviceFilePath } from "../capture/os-service.js";
import { validateApiKey } from "./api.js";
import { API_URL, pad } from "./config.js";
import { type ExistingSetup, detectEditors, detectExistingSetup, writeEditorConfigs } from "./editors/index.js";
import { globalConfigDir, removeDirIfExists, removeInstructions, removeSynapseFromMcpJson } from "./editors/io.js";
import { dispatchHook, readHookPayloadFromStdin } from "./hook-dispatch.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success, error as themeError } from "./theme.js";

// biome-ignore lint/suspicious/noExplicitAny: API responses
type R = Record<string, any>;

interface ClaudeHookBlock {
  matcher?: string;
  hooks: Array<{ type?: string; command?: string }>;
}
interface ClaudeSettingsShape {
  hooks?: Record<string, ClaudeHookBlock[]>;
  [key: string]: unknown;
}

// Subcommands the Synapse init flow registers as Claude Code hook handlers.
// Used to fingerprint Synapse-owned entries when migrating or uninstalling —
// matches both bare `synapse hook X` (v1.0) and absolute-path
// `"<node>" "<index.js>" hook X` (v1.1) without colliding on unrelated hooks.
const SYNAPSE_HOOK_SUBCOMMANDS = [
  "session-start",
  "user-prompt-submit",
  "post-tool-use",
  "pre-compact",
  "session-end",
  "subagent-stop",
] as const;

export function isSynapseHookCommand(cmd: string | undefined): boolean {
  if (typeof cmd !== "string") return false;
  return SYNAPSE_HOOK_SUBCOMMANDS.some((sub) => cmd.endsWith(` hook ${sub}`));
}

/**
 * Remove every hook block whose command invokes the Synapse hook dispatcher —
 * detects both v1.0 (`synapse hook X`) and v1.1 (`"<node>" "<index.js>" hook X`)
 * formats. Drops empty event arrays, and the `hooks` key entirely if every
 * Synapse-owned hook was cleared. Returns true if the file was modified.
 */
export function removeSynapseHooksFromClaudeSettings(settingsPath: string): boolean {
  let parsed: ClaudeSettingsShape;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as ClaudeSettingsShape;
  } catch {
    return false;
  }
  if (!parsed.hooks) return false;

  let changed = false;
  const nextHooks: Record<string, ClaudeHookBlock[]> = {};
  for (const [event, blocks] of Object.entries(parsed.hooks)) {
    const filtered = blocks.filter((b) => !b.hooks.some((h) => isSynapseHookCommand(h.command)));
    if (filtered.length !== blocks.length) changed = true;
    if (filtered.length > 0) nextHooks[event] = filtered;
  }

  if (!changed) return false;

  const { hooks: _drop, ...rest } = parsed;
  const out: ClaudeSettingsShape = Object.keys(nextHooks).length > 0 ? { ...rest, hooks: nextHooks } : rest;
  fs.writeFileSync(settingsPath, `${JSON.stringify(out, null, 2)}\n`);
  return true;
}

async function apiFetch<T>(apiKey: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const res = await fetch(`${API_URL}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Resolve a working API key from config files, or exit. */
async function resolveKey(existing?: ExistingSetup): Promise<string> {
  const setup = existing ?? detectExistingSetup();
  if (setup.apiKeys.length === 0) {
    clack.log.error("No API key found. Run the setup wizard first:");
    clack.log.message(`  ${accent("synapsesync wizard")}`);
    process.exit(1);
  }
  let fallback: string | null = null;
  for (const key of setup.apiKeys) {
    const s = await validateApiKey(key);
    if (s.status === "valid") return key;
    // "unknown" = transient (slow endpoint / timeout / 429 / 5xx), NOT a
    // confirmed auth failure. Keep it as a fallback so we never mis-report a
    // working key as expired; the caller's own (untimed) API calls surface any
    // real failure. Only "expired" (401 + auth code) is treated as dead.
    if (s.status === "unknown" && !fallback) fallback = key;
  }
  if (fallback) return fallback;
  clack.log.error(themeError("All API keys are expired. Sign in again:"));
  clack.log.message(`  ${accent("synapsesync wizard")}`);
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  tree — workspace file tree
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runTree(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Tree")}`);

  const spin = createGlyphSpinner();
  spin.start("Connecting\u2026");
  const apiKey = await resolveKey();

  spin.update("Fetching files\u2026");
  const projects = await apiFetch<R[]>(apiKey, "/api/projects");
  if (projects.length === 0) {
    spin.stop("No workspace yet.");
    clack.outro(muted("synapsesync.app"));
    return;
  }

  const project = projects[0];
  const entries = await apiFetch<{ path: string; tags: string[]; updated_at: string }[]>(
    apiKey,
    `/api/context/${encodeURIComponent(project.name)}/list`,
  );
  spin.stop(`${success("\u2713")} ${entries.length} files`);

  if (entries.length === 0) {
    clack.log.message(muted("(empty workspace)"));
    clack.outro(muted("synapsesync.app"));
    return;
  }

  // Build tree structure
  interface Node {
    children: Map<string, Node>;
    file: boolean;
  }
  const root: Node = { children: new Map(), file: false };

  for (const e of entries) {
    const parts = e.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      if (!current.children.has(parts[i])) {
        current.children.set(parts[i], { children: new Map(), file: i === parts.length - 1 });
      }
      const next = current.children.get(parts[i]);
      if (next) current = next;
    }
  }

  // Render tree with box-drawing characters
  const lines: string[] = [];

  function render(node: Node, prefix: string): void {
    const sorted = [...node.children.entries()].sort(([a], [b]) => {
      const aIsDir = !(node.children.get(a)?.file ?? false);
      const bIsDir = !(node.children.get(b)?.file ?? false);
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });

    for (let i = 0; i < sorted.length; i++) {
      const [name, child] = sorted[i];
      const isLast = i === sorted.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const childPrefix = isLast ? "    " : "\u2502   ";

      if (child.file) {
        lines.push(`${prefix}${connector}${muted(name)}`);
      } else {
        lines.push(`${prefix}${connector}${accent(name)}/`);
        render(child, prefix + childPrefix);
      }
    }
  }

  lines.push(accent("."));
  render(root, "");

  clack.log.message(lines.join("\n"));
  clack.log.message(muted(`Browse your files at ${accent("synapsesync.app")}`));
  clack.outro(muted("synapsesync.app"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  hook — dispatch a Claude Code hook event
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  Used by the entries in ~/.claude/settings.json that look like
//  `synapse hook session-start`. Reads the JSON event from stdin and
//  forwards it to the matching handler.

export async function runHook(args: string[]): Promise<void> {
  const kind = args[0];
  if (!kind) {
    process.stderr.write("usage: synapsesync hook <kind>\n");
    process.exit(1);
  }
  try {
    const payload = await readHookPayloadFromStdin();
    await dispatchHook(kind, payload);
  } catch (err) {
    // Hooks must never break Claude Code — log and exit 0.
    process.stderr.write(`hook ${kind} failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  status — show where configured + health
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runStatus(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Status")}`);

  const existing = detectExistingSetup();

  if (!existing.configured) {
    clack.log.warn("Synapse is not configured anywhere.");
    clack.log.message(`  Run ${accent("synapsesync wizard")} to set up.`);
    clack.outro(muted("synapsesync.app"));
    return;
  }

  // Validate each unique API key
  const spin = createGlyphSpinner();
  spin.start("Checking connections\u2026");

  const keyResults = new Map<string, boolean>();
  let validKey: string | null = null;

  for (const key of existing.apiKeys) {
    const s = await validateApiKey(key);
    const isValid = s.status === "valid";
    keyResults.set(key, isValid);
    if (isValid && !validKey) validKey = key;
  }

  spin.stop("Connection check complete");

  // Show per-location status
  const LW = 24;
  const statusLines = existing.locations
    .map((loc) => {
      const label = loc.label.padEnd(42);
      if (loc.status === "instructions_only") {
        return `  ${muted("\u25CB")} ${muted(label)} ${muted("instructions only")}`;
      }
      if (loc.status === "no_key") {
        return `  ${themeError("\u2717")} ${muted(label)} ${themeError("missing API key")}`;
      }
      const isValid = loc.apiKey ? keyResults.get(loc.apiKey) : undefined;
      if (isValid === true) {
        return `  ${success("\u2713")} ${muted(label)} ${success("connected")}`;
      }
      if (isValid === false) {
        return `  ${themeError("\u2717")} ${muted(label)} ${themeError("invalid key")}`;
      }
      return `  ${muted("?")} ${muted(label)} ${muted("unchecked")}`;
    })
    .join("\n");

  clack.log.message(`${bold("Configured in")}\n${statusLines}`);

  if (validKey) {
    // Fetch account info
    const projects = await apiFetch<R[]>(validKey, "/api/projects");
    const billing = await apiFetch<{ tier: string }>(validKey, "/api/billing/status");
    let fileCount = 0;
    if (projects.length > 0) {
      const entries = await apiFetch<R[]>(validKey, `/api/context/${encodeURIComponent(projects[0].name)}/list`);
      fileCount = entries.length;
    }

    clack.log.message(
      [
        `${pad(muted("Tier"), LW)} ${accent(billing.tier)}`,
        `${pad(muted("Files"), LW)} ${accent(String(fileCount))}`,
      ].join("\n"),
    );
  } else if (existing.apiKeys.length > 0) {
    clack.log.warn(`All API keys are expired. Run ${accent("synapsesync refresh")} to get a new key.`);
  } else {
    clack.log.warn(`No API keys found. Run ${accent("synapsesync wizard")} to set up.`);
  }

  clack.outro(muted("synapsesync.app"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  refresh — new API key, update all configs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runRefresh(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Refresh API Key")}`);

  const existing = detectExistingSetup();
  if (existing.apiKeys.length === 0) {
    clack.log.error("No existing API key found. Run the setup wizard:");
    clack.log.message(`  ${accent("synapsesync wizard")}`);
    process.exit(1);
  }

  const spin = createGlyphSpinner();
  spin.start("Validating current key\u2026");
  const oldKey = await resolveKey(existing);

  spin.update("Creating new API key\u2026");
  const result = await apiFetch<{ api_key: string }>(oldKey, "/api/account/keys", "POST", { label: "cli" });
  const newKey = result.api_key;
  spin.stop(`${success("\u2713")} New key created`);

  // Detect scope from existing setup
  const isGlobal = existing.locations.some((l) => l.label.startsWith("~"));
  const scope = isGlobal ? "global" : "local";
  const editors = detectEditors(scope).filter((e) => e.detected);
  const writeResult = writeEditorConfigs(editors, newKey);

  if (writeResult.written.length > 0) {
    clack.log.message(
      `${bold("Updated")}\n${writeResult.written.map((f) => `  ${success("\u2713")} ${muted(f)}`).join("\n")}`,
    );
  }
  if (writeResult.errors.length > 0) {
    for (const err of writeResult.errors) {
      clack.log.warn(`${err.editor}: ${err.error}`);
    }
  }

  clack.outro(muted("API key refreshed in all configured editors"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  whoami — account info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runWhoami(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse")}`);

  const spin = createGlyphSpinner();
  spin.start("Connecting\u2026");
  const apiKey = await resolveKey();

  const projects = await apiFetch<R[]>(apiKey, "/api/projects");
  const billing = await apiFetch<{ tier: string }>(apiKey, "/api/billing/status");
  const keys = await apiFetch<R[]>(apiKey, "/api/account/keys");
  let fileCount = 0;
  if (projects.length > 0) {
    const entries = await apiFetch<R[]>(apiKey, `/api/context/${encodeURIComponent(projects[0].name)}/list`);
    fileCount = entries.length;
  }
  spin.stop(`${success("\u2713")} Connected`);

  const email = projects[0]?.owner_email ?? "unknown";
  const LW = 20;

  clack.log.message(
    [
      `${pad(muted("Email"), LW)} ${bold(email)}`,
      `${pad(muted("Tier"), LW)} ${accent(billing.tier)}${billing.tier === "free" ? muted("  \u2192 synapsesync upgrade") : ""}`,
      `${pad(muted("Files"), LW)} ${accent(String(fileCount))}`,
      `${pad(muted("API keys"), LW)} ${accent(String(keys.length))}`,
      `${pad(muted("Dashboard"), LW)} ${accent("synapsesync.app")}`,
      `${pad(muted("Account"), LW)} ${accent("synapsesync.app/account")}`,
    ].join("\n"),
  );

  clack.outro(muted("synapsesync.app"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  reset — wipe all data, keep account
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runReset(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Reset Account Data")}`);

  const apiKey = await resolveKey();

  clack.log.warn(
    [
      `${themeError("This will permanently delete all your workspace data:")}`,
      "",
      `  ${themeError("\u2022")} All projects and files`,
      `  ${themeError("\u2022")} All conversations and messages`,
      `  ${themeError("\u2022")} All insights`,
      `  ${themeError("\u2022")} All API keys (a fresh one will be generated)`,
      "",
      "Your account and subscription will remain intact.",
    ].join("\n"),
  );

  const confirm = await clack.confirm({
    message: "Are you sure you want to reset all data?",
    initialValue: false,
  });

  if (clack.isCancel(confirm) || !confirm) {
    clack.outro(muted("Reset cancelled."));
    return;
  }

  const doubleConfirm = await clack.text({
    message: `Type ${bold("RESET")} to confirm:`,
    validate: (val) => (val !== "RESET" ? 'Please type "RESET" to confirm.' : undefined),
  });

  if (clack.isCancel(doubleConfirm)) {
    clack.outro(muted("Reset cancelled."));
    return;
  }

  const spin = createGlyphSpinner();
  spin.start("Resetting account data\u2026");

  try {
    const result = await apiFetch<{ ok: boolean; api_key: string }>(apiKey, "/api/account/reset", "POST");
    spin.stop(`${success("\u2713")} Account data reset`);

    // Update editor configs with the new API key
    const existing = detectExistingSetup();
    const isGlobal = existing.locations.some((l) => l.label.startsWith("~"));
    const scope = isGlobal ? "global" : "local";
    const editors = detectEditors(scope).filter((e) => e.detected);
    const writeResult = writeEditorConfigs(editors, result.api_key);

    if (writeResult.written.length > 0) {
      clack.log.message(
        `${bold("Updated configs with new API key")}\n${writeResult.written.map((f) => `  ${success("\u2713")} ${muted(f)}`).join("\n")}`,
      );
    }
  } catch (err) {
    spin.stop(themeError("Reset failed"));
    clack.log.error(err instanceof Error ? err.message : "Unknown error");
  }

  clack.outro(muted("synapsesync.app"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  upgrade — open checkout or show sub info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runUpgrade(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Plus")}`);

  const spin = createGlyphSpinner();
  spin.start("Checking subscription\u2026");
  const apiKey = await resolveKey();

  const billing = await apiFetch<{
    tier: string;
    subscription: { status: string; current_period_end: string | null; cancel_at_period_end: boolean } | null;
  }>(apiKey, "/api/billing/status");

  if (billing.tier === "plus") {
    spin.stop(`${success("\u2713")} You're on Plus`);
    const sub = billing.subscription;
    if (sub?.current_period_end) {
      const renews = new Date(sub.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      clack.log.message(
        sub.cancel_at_period_end ? muted(`Active until ${renews} (will not renew)`) : muted(`Renews ${renews}`),
      );
    }
    clack.log.message(`Manage your subscription at ${accent("synapsesync.app/account")}`);
    clack.outro(muted("synapsesync.app"));
    return;
  }

  spin.update("Creating checkout\u2026");
  try {
    const checkout = await apiFetch<{ url: string }>(apiKey, "/api/billing/checkout", "POST");
    spin.stop(`${success("\u2713")} Checkout ready`);

    clack.log.message(
      [
        `${bold("Synapse Plus")} \u2014 $5.99/mo`,
        "",
        `  ${accent("\u2713")} 500 files (vs 50 free)`,
        `  ${accent("\u2713")} Unlimited connections`,
        `  ${accent("\u2713")} Full version history`,
        `  ${accent("\u2713")} Unlimited team members`,
      ].join("\n"),
    );

    // Open browser
    const url = checkout.url;
    try {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      child_process.exec(`${cmd} "${url}"`);
      clack.log.success("Opened checkout in your browser.");
    } catch {
      clack.log.message(`Open this URL to complete checkout:\n  ${accent(url)}`);
    }
  } catch (_err) {
    spin.stop(themeError("Could not create checkout"));
    clack.log.message(`Upgrade at ${accent("synapsesync.app/account")}`);
  }

  clack.outro(muted("synapsesync.app"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  uninstall — remove all Synapse configs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runUninstall(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Uninstall Synapse")}`);

  const home = os.homedir();
  const cwd = process.cwd();

  // Discover everything Synapse has touched
  const targets: { label: string; action: () => boolean }[] = [];

  // MCP config files — remove the synapse key
  const mcpFiles: [string, string][] = [
    [path.join(cwd, ".mcp.json"), ".mcp.json"],
    [path.join(cwd, ".cursor", "mcp.json"), ".cursor/mcp.json"],
    [path.join(cwd, ".vscode", "mcp.json"), ".vscode/mcp.json"],
    [path.join(home, ".cursor", "mcp.json"), "~/.cursor/mcp.json"],
    [path.join(home, ".claude.json"), "~/.claude.json"],
    [path.join(home, ".claude", ".mcp.json"), "~/.claude/.mcp.json"],
    [path.join(home, ".codeium", "windsurf", "mcp_config.json"), "~/.codeium/windsurf/mcp_config.json"],
    [path.join(globalConfigDir(), "Code", "User", "mcp.json"), "VS Code user mcp.json"],
  ];
  for (const [filePath, label] of mcpFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (content.includes("synapse")) {
          targets.push({ label: `Remove synapse from ${label}`, action: () => removeSynapseFromMcpJson(filePath) });
        }
      } catch {
        /* skip unreadable */
      }
    }
  }

  // Instruction injections — remove the Synapse section
  const instructionFiles: [string, string][] = [
    [path.join(home, ".claude", "CLAUDE.md"), "~/.claude/CLAUDE.md"],
    [path.join(cwd, ".cursorrules"), ".cursorrules"],
    [path.join(cwd, ".windsurfrules"), ".windsurfrules"],
    [path.join(cwd, ".github", "copilot-instructions.md"), ".github/copilot-instructions.md"],
  ];
  for (const [filePath, label] of instructionFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (content.includes("# Synapse")) {
          targets.push({ label: `Remove Synapse section from ${label}`, action: () => removeInstructions(filePath) });
        }
      } catch {
        /* skip */
      }
    }
  }

  // The Synapse-namespaced slash command dir is wholly owned by us —
  // delete it outright rather than filtering by filename (v1.1 commands are
  // named handoff.md / focus.md / issue.md / status.md / doctor.md / invite.md
  // — none contain "synapse" in the filename).
  const synapseSlashDir = path.join(home, ".claude", "commands", "synapse");
  if (fs.existsSync(synapseSlashDir)) {
    targets.push({
      label: "Delete ~/.claude/commands/synapse/ (slash commands)",
      action: () => removeDirIfExists(synapseSlashDir),
    });
  }

  // Non-namespaced command/prompt directories — only synapse-prefixed files
  // are removed; other tools' files stay.
  const commandDirs: [string, string][] = [
    [path.join(cwd, ".cursor", "commands"), ".cursor/commands/"],
    [path.join(cwd, ".github", "prompts"), ".github/prompts/"],
    [path.join(cwd, ".windsurf", "workflows"), ".windsurf/workflows/"],
    [path.join(home, ".cursor", "commands"), "~/.cursor/commands/"],
  ];
  for (const [dirPath, label] of commandDirs) {
    if (fs.existsSync(dirPath)) {
      try {
        const files = fs.readdirSync(dirPath);
        if (files.some((f) => f.includes("synapse"))) {
          targets.push({
            label: `Delete synapse commands from ${label}`,
            action: () => {
              for (const f of files) {
                if (f.includes("synapse")) {
                  fs.unlinkSync(path.join(dirPath, f));
                }
              }
              try {
                const remaining = fs.readdirSync(dirPath);
                if (remaining.length === 0) fs.rmdirSync(dirPath);
              } catch {
                /* skip */
              }
              return true;
            },
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  // Synapse hooks installed by `synapse init` into ~/.claude/settings.json.
  // Strips every block whose command invokes the Synapse hook dispatcher —
  // works for both v1.0 (`synapse hook X`) and v1.1 (absolute-path) formats.
  const claudeSettingsPath = path.join(home, ".claude", "settings.json");
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf-8")) as ClaudeSettingsShape;
      const hasSynapseHook = Object.values(parsed.hooks ?? {}).some((blocks) =>
        blocks.some((b) => b.hooks.some((h) => isSynapseHookCommand(h.command))),
      );
      if (hasSynapseHook) {
        targets.push({
          label: "Remove Synapse hooks from ~/.claude/settings.json",
          action: () => removeSynapseHooksFromClaudeSettings(claudeSettingsPath),
        });
      }
    } catch {
      /* skip unreadable */
    }
  }

  // OS service unit installed by `synapse init` (launchd plist on macOS,
  // systemd unit on Linux). Unloads from the supervisor before deleting.
  const servicePath = serviceFilePath();
  if (servicePath && fs.existsSync(servicePath)) {
    const label =
      process.platform === "darwin"
        ? "Unload + delete launchd plist (~/Library/LaunchAgents/app.synapsesync.daemon.plist)"
        : "Disable + delete systemd unit (~/.config/systemd/user/synapsesync.service)";
    targets.push({ label, action: () => removeServiceFile() });
  }

  // Capture daemon
  try {
    const { DaemonManager } = await import("../capture/daemon.js");
    const daemon = new DaemonManager();
    if (daemon.isRunning()) {
      targets.push({
        label: "Stop capture daemon",
        action: () => {
          const pid = daemon.readPid();
          if (pid) {
            try {
              process.kill(pid, "SIGTERM");
            } catch {
              /* already gone */
            }
          }
          daemon.cleanup();
          return true;
        },
      });
    }
  } catch {
    /* daemon module not available */
  }

  // ~/.synapse directory
  const synapseDir = path.join(home, ".synapse");
  if (fs.existsSync(synapseDir)) {
    targets.push({
      label: "Delete ~/.synapse/ (local sessions + daemon files)",
      action: () => removeDirIfExists(synapseDir),
    });
  }

  if (targets.length === 0) {
    clack.log.info("No Synapse configuration found on this machine.");
    clack.outro(muted("Nothing to do."));
    return;
  }

  // Show what will be removed
  clack.log.message(
    `${bold("Found Synapse in these locations:")}\n${targets.map((t) => `  ${themeError("\u2022")} ${muted(t.label)}`).join("\n")}`,
  );

  const confirm = await clack.confirm({
    message: `Remove Synapse from all ${targets.length} locations?`,
    initialValue: false,
  });

  if (clack.isCancel(confirm) || !confirm) {
    clack.outro(muted("Uninstall cancelled."));
    return;
  }

  // Execute removals
  let removed = 0;
  for (const target of targets) {
    try {
      if (target.action()) {
        clack.log.success(target.label);
        removed++;
      }
    } catch (err) {
      clack.log.warn(`${target.label}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  clack.log.message(`\n${bold(`Removed ${removed}/${targets.length} items.`)}`);
  clack.log.message(muted("To also delete your cloud data, visit synapsesync.app/account"));

  clack.outro(muted("Synapse has been uninstalled."));
}
