import * as clack from "@clack/prompts";
import { validateApiKey } from "./api.js";
import { browserAuth } from "./browser-auth.js";
import type { SetupScope } from "./editors.js";
import { detectEditors, detectExistingSetup, writeEditorConfigs } from "./editors.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success, error as themeError } from "./theme.js";
import { showWelcome } from "./welcome.js";

export async function runWizard(version: string): Promise<void> {
  // Step 1: Animated welcome
  await showWelcome(version);

  clack.intro(`${accent("\u25C6")} ${bold("Synapse setup")}`);

  // Check for existing setup
  const existing = detectExistingSetup();
  if (existing.configured) {
    const locations = existing.locations.map((l) => `  ${muted(l)}`).join("\n");

    // Validate existing API key
    let keyExpired = false;
    if (existing.apiKey) {
      const spin = createGlyphSpinner();
      spin.start("Checking existing connection\u2026");
      const keyStatus = await validateApiKey(existing.apiKey);
      if (keyStatus.status === "expired") {
        spin.stop(themeError("API key expired or revoked"));
        keyExpired = true;
      } else if (keyStatus.status === "valid") {
        spin.stop(`${success("\u2713")} Connected`);
      } else {
        spin.stop(muted("Could not verify connection"));
      }
    }

    if (keyExpired) {
      clack.log.warn(`Synapse is configured but your API key has expired:\n${locations}`);
      clack.log.info("Sign in again to get a new API key.");
      // Fall through to full auth flow
    } else {
      clack.log.info(`Synapse is already configured:\n${locations}`);

      const action = await clack.select({
        message: "What would you like to do?",
        options: [
          { value: "reconfigure" as const, label: "Reconfigure", hint: "new API key + choose editors" },
          {
            value: "add" as const,
            label: "Add more editors",
            hint: existing.apiKey ? "keep current API key" : "paste your API key",
          },
          { value: "cancel" as const, label: "Cancel" },
        ],
      });

      if (clack.isCancel(action) || action === "cancel") {
        clack.cancel("No changes made.");
        process.exit(0);
      }

      if (action === "add") {
        if (existing.apiKey) {
          await runEditorSetup(existing.apiKey);
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

  clack.outro(`Restart your editor to connect. ${muted("synapsesync.app/docs")}`);
}
