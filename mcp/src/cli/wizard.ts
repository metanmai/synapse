import * as clack from "@clack/prompts";
import { browserAuth } from "./browser-auth.js";
import { detectEditors, writeEditorConfigs } from "./editors.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success } from "./theme.js";
import { showWelcome } from "./welcome.js";

export async function runWizard(version: string): Promise<void> {
  // Step 1: Animated welcome
  await showWelcome(version);

  // Step 2: Auth method
  clack.intro(`${accent("\u25C6")} ${bold("Synapse setup")}`);

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
    spin.start("Waiting for browser login\u2026");

    try {
      const result = await browserAuth();
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

  // Step 5: Editor selection
  const allEditors = detectEditors();
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

  // Step 6: Confirmation
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
  const written = writeEditorConfigs(selectedEditors, apiKey);
  configSpin.stop("Config files written");

  // Step 7: Success summary
  const summary = written.map((f) => `  ${success("\u2713")} ${f}`).join("\n");
  clack.log.message(summary);

  clack.outro(`Restart your editor to connect. ${muted("synapsesync.app/docs")}`);
}
