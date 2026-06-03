import { SessionStore } from "../capture/store.js";
import type { CapturedSession } from "../capture/types.js";
import { accent, bold, muted } from "../cli/theme.js";
import { distillSession } from "./index.js";

const store = new SessionStore();

export async function runDistill(args: string[]): Promise<void> {
  const sessionId = args[0];

  if (!sessionId && !args.includes("--latest")) {
    console.log(`${bold("Usage:")}`);
    console.log("  npx synapsesync-mcp distill <session-id>   Distill a specific session");
    console.log("  npx synapsesync-mcp distill --latest       Distill the most recent session");
    return;
  }

  // Resolve session
  let session: CapturedSession | null = null;
  if (args.includes("--latest")) {
    const sessions = store.list();
    if (sessions.length === 0) {
      console.log(muted("No captured sessions. Run 'capture start' first."));
      return;
    }
    session = sessions[0];
  } else {
    session = store.load(sessionId);
    if (!session) {
      console.log(`Session not found: ${sessionId}`);
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
    console.log("Set SYNAPSE_DISTILL_API_KEY to your LLM provider API key.");
    console.log("  export SYNAPSE_DISTILL_API_KEY=sk-ant-...");
    console.log(`  export SYNAPSE_DISTILL_PROVIDER=${provider}`);
    console.log(`  export SYNAPSE_DISTILL_MODEL=${model}`);
    return;
  }

  if (!synapseApiKey) {
    console.log("Set SYNAPSE_API_KEY to write results to your workspace.");
    return;
  }

  console.log(`${accent("Distilling")} session ${session.id} (${session.messages.length} messages)...`);
  console.log(muted(`Provider: ${provider} / ${model}`));

  try {
    const result = await distillSession(session, {
      provider,
      apiKey,
      model,
      synapseApiKey,
      project,
      log: (msg) => console.log(muted(`  ${msg}`)),
    });

    if (result.filesWritten === 0) {
      console.log(muted("No insights extracted from this session."));
    } else {
      console.log(`\n${accent(`${result.filesWritten} file(s) written to workspace:`)}`);
      for (const f of result.files) {
        console.log(`  ${f.path}`);
      }
    }
  } catch (err) {
    console.log(`Distill failed: ${err}`);
  }
}
