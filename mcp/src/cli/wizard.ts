import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { validateApiKey } from "./api.js";
import { browserAuth } from "./browser-auth.js";
import type { ConfigLocation, SetupScope } from "./editors/index.js";
import { detectEditors, detectExistingSetup, writeEditorConfigs } from "./editors/index.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success, error as themeError } from "./theme.js";
import { showWelcome } from "./welcome.js";

function formatLocationStatus(loc: ConfigLocation, keyValid: boolean | null): string {
  const label = loc.label.padEnd(42);
  if (loc.status === "instructions_only") {
    return `  ${muted("\u25CB")} ${muted(label)} ${muted("instructions only")}`;
  }
  if (loc.status === "no_key") {
    return `  ${themeError("\u2717")} ${muted(label)} ${themeError("missing API key")}`;
  }
  // has_key
  if (keyValid === true) {
    return `  ${success("\u2713")} ${muted(label)} ${success("connected")}`;
  }
  if (keyValid === false) {
    return `  ${themeError("\u2717")} ${muted(label)} ${themeError("invalid key")}`;
  }
  return `  ${muted("?")} ${muted(label)} ${muted("unchecked")}`;
}

export async function runWizard(version: string): Promise<void> {
  // Step 1: Animated welcome
  await showWelcome(version);

  clack.intro(`${accent("\u25C6")} ${bold("Synapse setup")}`);

  // Check for existing setup
  const existing = detectExistingSetup();
  if (existing.configured) {
    // Validate each unique API key
    const keyResults = new Map<string, boolean>(); // key -> valid
    let validKey: string | null = null;
    let keyExpired = false;

    if (existing.apiKeys.length > 0) {
      const spin = createGlyphSpinner();
      spin.start("Checking connections\u2026");
      for (const key of existing.apiKeys) {
        const keyStatus = await validateApiKey(key);
        if (keyStatus.status === "valid") {
          keyResults.set(key, true);
          if (!validKey) validKey = key;
        } else {
          keyResults.set(key, false);
          if (keyStatus.status === "expired") keyExpired = true;
        }
      }
      spin.stop("Connection check complete");
    }

    // Build per-location status lines
    const statusLines = existing.locations
      .map((loc) => {
        const keyValid = loc.apiKey ? (keyResults.get(loc.apiKey) ?? null) : null;
        return formatLocationStatus(loc, keyValid);
      })
      .join("\n");

    const hasProblems = existing.locations.some(
      (loc) => loc.status === "no_key" || (loc.apiKey != null && keyResults.get(loc.apiKey) === false),
    );

    if (keyExpired && !validKey) {
      clack.log.warn(`Synapse is configured but your API key has expired:\n${statusLines}`);
      clack.log.info("Sign in again to get a new API key.");
      // Fall through to full auth flow
    } else {
      if (hasProblems) {
        clack.log.warn(`Synapse has configuration issues:\n${statusLines}`);
      } else {
        clack.log.info(`Synapse status:\n${statusLines}`);
      }

      const options: { value: string; label: string; hint?: string }[] = [];
      if (hasProblems && validKey) {
        options.push({
          value: "fix",
          label: "Fix issues",
          hint: "apply working API key to broken configs",
        });
      }
      options.push(
        { value: "reconfigure", label: "Reconfigure", hint: "new API key + choose editors" },
        {
          value: "add",
          label: "Add more editors",
          hint: validKey ? "keep current API key" : "paste your API key",
        },
        { value: "cancel", label: "Cancel" },
      );

      const action = await clack.select({ message: "What would you like to do?", options });

      if (clack.isCancel(action) || action === "cancel") {
        clack.cancel("No changes made.");
        process.exit(0);
      }

      if (action === "fix" && validKey) {
        await runFixIssues(existing.locations, validKey);
        return;
      }

      if (action === "add") {
        if (validKey) {
          await runEditorSetup(validKey);
        } else {
          clack.log.info("Paste your existing API key to configure additional editors.");
          const key = await clack.password({
            message: "API key",
            validate: (v) => (v?.trim() ? undefined : "Required"),
          });
          if (clack.isCancel(key)) {
            clack.cancel("Cancelled.");
            process.exit(0);
          }
          await runEditorSetup(key.trim());
        }
        return;
      }

      // action === "reconfigure" — fall through to full wizard
    }
  }

  // Step 2: Auth method
  const authMethod = await clack.select({
    message: "How do you want to connect?",
    options: [
      { value: "browser" as const, label: "Sign in with browser", hint: "opens synapsesync.app" },
      { value: "key" as const, label: "Paste an API key", hint: "from the dashboard" },
    ],
  });

  if (clack.isCancel(authMethod)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  // Step 3 + 4: Auth
  let apiKey: string;

  if (authMethod === "browser") {
    const spin = createGlyphSpinner();

    try {
      const result = await browserAuth({
        onUrl: (url, autoOpened) => {
          if (autoOpened) {
            spin.start("Waiting for browser login\u2026");
            clack.log.info(`If the browser didn't open, visit:\n  ${muted(url)}`);
          } else {
            spin.start("Waiting for login\u2026");
            clack.log.info(`Open this URL to sign in:\n  ${muted(url)}`);
          }
        },
      });
      spin.stop(`Signed in as ${result.email}`);
      apiKey = result.api_key;
    } catch (err) {
      spin.stop("Login failed");
      clack.log.error((err as Error).message);
      process.exit(1);
    }
  } else {
    clack.log.info("Create a key at synapsesync.app \u2192 Account \u2192 API keys");
    const key = await clack.password({
      message: "API key",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    if (clack.isCancel(key)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    apiKey = key.trim();
  }

  await runEditorSetup(apiKey);
}

async function runFixIssues(locations: ConfigLocation[], validKey: string): Promise<void> {
  const broken = locations.filter((l) => l.status === "no_key");
  if (broken.length === 0) {
    clack.log.info("No issues to fix.");
    clack.outro("All good!");
    return;
  }

  const preview = broken.map((l) => `  ${muted(l.label)}`).join("\n");
  clack.log.message(`Will add API key to:\n${preview}`);

  const confirmed = await clack.confirm({ message: "Apply fix?" });
  if (clack.isCancel(confirmed) || !confirmed) {
    clack.cancel("No changes made.");
    process.exit(0);
  }

  const spin = createGlyphSpinner();
  spin.start("Fixing configs\u2026");

  const fixed: string[] = [];
  const errors: string[] = [];

  for (const loc of broken) {
    try {
      injectApiKey(loc.filePath, validKey);
      fixed.push(loc.label);
    } catch (err) {
      errors.push(`${loc.label}: ${(err as Error).message}`);
    }
  }

  spin.stop("Done");

  if (fixed.length > 0) {
    const summary = fixed.map((f) => `  ${success("\u2713")} ${f}`).join("\n");
    clack.log.message(summary);
  }
  for (const e of errors) {
    clack.log.warn(`${themeError("\u2717")} ${e}`);
  }

  clack.outro(
    `Restart your editor to connect. ${muted("Run 'npx synapsesync-mcp capture start' to begin capturing sessions.")}`,
  );
}

/** Inject SYNAPSE_API_KEY into an existing config file that has a synapse server entry but no key. */
function injectApiKey(filePath: string, apiKey: string): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  // Find the synapse server object in whichever format
  const synapse = parsed?.mcpServers?.synapse ?? parsed?.mcp?.servers?.synapse ?? parsed?.servers?.synapse;

  if (synapse && typeof synapse === "object") {
    if (!synapse.env || typeof synapse.env !== "object") {
      synapse.env = {};
    }
    synapse.env.SYNAPSE_API_KEY = apiKey;
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    return;
  }

  throw new Error("Could not find synapse server config");
}

async function runEditorSetup(apiKey: string): Promise<void> {
  // Scope
  const scope = await clack.select({
    message: "Where should Synapse be configured?",
    options: [
      { value: "local" as const, label: "This project only", hint: "writes config to current directory" },
      { value: "global" as const, label: "Globally", hint: "available in all projects" },
    ],
  });

  if (clack.isCancel(scope)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  // Editor selection
  const allEditors = detectEditors(scope as SetupScope);
  const editorChoice = await clack.multiselect({
    message: "Which tools should Synapse connect to?",
    options: allEditors.map((e) => ({
      value: e.id,
      label: e.name,
      hint: e.detected ? e.hint : "not detected",
    })),
    initialValues: allEditors.filter((e) => e.detected).map((e) => e.id),
    required: true,
  });

  if (clack.isCancel(editorChoice)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  const selectedEditors = allEditors.filter((e) => (editorChoice as string[]).includes(e.id));

  // Confirmation
  const filePreview = selectedEditors.map((e) => `  ${muted(e.hint)}`).join("\n");
  clack.log.message(`Files to create/update:\n${filePreview}`);

  const confirmed = await clack.confirm({
    message: "Ready to write config files?",
  });

  if (clack.isCancel(confirmed) || !confirmed) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  // Write configs
  const configSpin = createGlyphSpinner();
  configSpin.start("Writing configs\u2026");
  const result = writeEditorConfigs(selectedEditors, apiKey);
  configSpin.stop("Config files written");

  // Success summary
  if (result.written.length > 0) {
    const summary = result.written.map((f) => `  ${success("\u2713")} ${f}`).join("\n");
    clack.log.message(summary);
  }

  if (result.errors.length > 0) {
    for (const e of result.errors) {
      clack.log.warn(`${themeError("\u2717")} ${e.editor}: ${e.error}`);
    }
  }

  // Offer to start session capture
  const startCapture = await clack.confirm({
    message: "Start capturing AI sessions automatically?",
    initialValue: true,
  });

  if (!clack.isCancel(startCapture) && startCapture) {
    const captureSpin = createGlyphSpinner();
    captureSpin.start("Starting capture daemon\u2026");

    try {
      const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture", "capture-worker.js");
      const child = spawn(process.execPath, [workerPath], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.unref();

      if (child.pid) {
        // Write PID file
        const pidDir = path.join(process.env.HOME ?? "~", ".synapse");
        fs.mkdirSync(pidDir, { recursive: true });
        fs.writeFileSync(path.join(pidDir, "capture.pid"), String(child.pid));
        captureSpin.stop(`Capture daemon started (PID ${child.pid})`);
      } else {
        captureSpin.stop("Capture daemon started");
      }
    } catch {
      captureSpin.stop("Could not start capture daemon");
      clack.log.info(`Start it manually: ${muted("npx synapsesync-mcp capture start")}`);
    }
  }

  clack.outro(
    `Restart your editor to connect. ${muted("Your sessions will be captured and distilled automatically.")}`,
  );
}
