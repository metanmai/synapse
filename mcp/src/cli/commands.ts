import child_process from "node:child_process";
import * as clack from "@clack/prompts";
import { validateApiKey } from "./api.js";
import { API_URL, pad } from "./config.js";
import { type ExistingSetup, detectEditors, detectExistingSetup, writeEditorConfigs } from "./editors/index.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success, error as themeError } from "./theme.js";

// biome-ignore lint/suspicious/noExplicitAny: API responses
type R = Record<string, any>;

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
    clack.log.message(`  ${accent("npx synapsesync-mcp")}`);
    process.exit(1);
  }
  for (const key of setup.apiKeys) {
    const s = await validateApiKey(key);
    if (s.status === "valid") return key;
  }
  clack.log.error(themeError("All API keys are expired. Sign in again:"));
  clack.log.message(`  ${accent("npx synapsesync-mcp")}`);
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
//  status — show where configured + health
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runStatus(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Synapse Status")}`);

  const existing = detectExistingSetup();

  if (!existing.configured) {
    clack.log.warn("Synapse is not configured anywhere.");
    clack.log.message(`  Run ${accent("npx synapsesync-mcp")} to set up.`);
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
    clack.log.warn(`All API keys are expired. Run ${accent("npx synapsesync-mcp refresh")} to get a new key.`);
  } else {
    clack.log.warn(`No API keys found. Run ${accent("npx synapsesync-mcp")} to set up.`);
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
    clack.log.message(`  ${accent("npx synapsesync-mcp")}`);
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
      `${pad(muted("Tier"), LW)} ${accent(billing.tier)}${billing.tier === "free" ? muted("  \u2192 npx synapsesync-mcp upgrade") : ""}`,
      `${pad(muted("Files"), LW)} ${accent(String(fileCount))}`,
      `${pad(muted("API keys"), LW)} ${accent(String(keys.length))}`,
      `${pad(muted("Dashboard"), LW)} ${accent("synapsesync.app")}`,
      `${pad(muted("Account"), LW)} ${accent("synapsesync.app/account")}`,
    ].join("\n"),
  );

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
