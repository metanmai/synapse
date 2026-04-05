import * as clack from "@clack/prompts";
import { SessionStore } from "../capture/store.js";
import type { CapturedSession } from "../capture/types.js";
import { createGlyphSpinner } from "../cli/spinner.js";
import { accent, bold, muted, success } from "../cli/theme.js";
import { distillSession } from "./index.js";

const store = new SessionStore();

export async function runDistill(args: string[]): Promise<void> {
  const sessionId = args[0];

  if (!sessionId && !args.includes("--latest")) {
    clack.intro(`${accent("\u25C6")} ${bold("Synapse Distill")}`);
    clack.log.message(
      [
        `  ${accent("<session-id>")}   Extract knowledge from a specific session`,
        `  ${accent("--latest")}       Distill the most recent captured session`,
      ].join("\n"),
    );
    clack.outro(muted("npx synapsesync-mcp distill <command>"));
    return;
  }

  clack.intro(`${accent("\u25C6")} ${bold("Synapse Distill")}`);

  // Resolve session
  let session: CapturedSession | null = null;
  if (args.includes("--latest")) {
    const sessions = store.list();
    if (sessions.length === 0) {
      clack.log.warn("No captured sessions found.");
      clack.log.message(muted(`  Run ${accent("npx synapsesync-mcp capture start")} first.`));
      clack.outro(muted("synapsesync.app"));
      return;
    }
    session = sessions[0];
  } else {
    session = store.load(sessionId);
    if (!session) {
      clack.log.error(`Session not found: ${accent(sessionId)}`);
      clack.log.message(muted(`  Run ${accent("npx synapsesync-mcp capture list")} to see available sessions.`));
      clack.outro(muted("synapsesync.app"));
      return;
    }
  }

  // Resolve config
  const provider = process.env.SYNAPSE_DISTILL_PROVIDER ?? "anthropic";
  const model = process.env.SYNAPSE_DISTILL_MODEL ?? "claude-sonnet-4-6";
  const apiKey = process.env.SYNAPSE_DISTILL_API_KEY;
  const synapseApiKey = process.env.SYNAPSE_API_KEY;
  const project = process.env.SYNAPSE_PROJECT ?? "My Workspace";

  if (!apiKey) {
    clack.log.warn("No LLM provider key configured.");
    clack.log.message(
      [
        "",
        `  ${muted("export")} ${accent("SYNAPSE_DISTILL_API_KEY")}${muted("=sk-ant-...")}`,
        `  ${muted("export")} ${accent("SYNAPSE_DISTILL_PROVIDER")}${muted(`=${provider}`)}`,
        `  ${muted("export")} ${accent("SYNAPSE_DISTILL_MODEL")}${muted(`=${model}`)}`,
        "",
      ].join("\n"),
    );
    clack.outro(muted("Set the env vars above and try again"));
    return;
  }

  if (!synapseApiKey) {
    clack.log.warn(`Set ${accent("SYNAPSE_API_KEY")} to write results to your workspace.`);
    clack.outro(muted("synapsesync.app/account"));
    return;
  }

  clack.log.info(
    `Session ${accent(session.id)} ${muted("\u00B7")} ${session.tool} ${muted("\u00B7")} ${session.messages.length} messages`,
  );

  const spin = createGlyphSpinner();
  spin.start(`Distilling with ${provider}/${model}\u2026`);

  try {
    const result = await distillSession(session, {
      provider,
      apiKey,
      model,
      synapseApiKey,
      project,
    });

    if (result.filesWritten === 0) {
      spin.stop("No insights extracted from this session.");
      clack.outro(muted("Session may be too short or routine"));
    } else {
      spin.stop(`${success("\u2713")} ${result.filesWritten} file(s) written`);
      const fileLines = result.files.map((f) => `  ${success("\u2713")} ${accent(f.path)}`).join("\n");
      clack.log.message(fileLines);
      clack.outro(muted("Knowledge saved to your workspace"));
    }
  } catch (err) {
    spin.stop("Distillation failed");
    clack.log.error(String(err));
    clack.outro(muted("Check your API key and try again"));
  }
}
