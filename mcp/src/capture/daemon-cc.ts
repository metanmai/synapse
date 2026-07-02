import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { appendEvent, readEvents } from "./events-log.js";
import { projectDir, synapseRoot } from "./handoff-paths.js";

export function writeDaemonCcProfile(): string {
  const p = path.join(synapseRoot(), "daemon-cc-profile.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const profile = {
    permissions: {
      deny: ["Edit", "Write", "MultiEdit", "Bash", "NotebookEdit", "Agent", "WebFetch"],
      allow: ["Read"],
    },
    model: "claude-haiku-4-5-20251001",
  };
  fs.writeFileSync(p, JSON.stringify(profile, null, 2));
  return p;
}

interface SpawnArgs {
  project_id: string;
  recent_events_summary: string;
  spawn?: typeof nodeSpawn;
  bin?: string;
  on_stdout?: (chunk: string) => void;
}

export async function spawnInferNextStep(a: SpawnArgs): Promise<string> {
  const spawnFn = a.spawn ?? nodeSpawn;
  const bin = a.bin ?? "claude";
  const profile = writeDaemonCcProfile();
  const prompt = `Given the following recent activity on this project, write ONE concise sentence describing what a teammate would need to do next to continue. Reply with the sentence and nothing else.\n\n---\n${a.recent_events_summary}\n---`;
  return await new Promise((resolve, reject) => {
    const child = spawnFn(bin, ["-p", prompt, "--config", profile, "--max-turns", "1"], {
      env: { ...process.env, SYNAPSE_DAEMON_SESSION: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      a.on_stdout?.(chunk.toString());
    });
    child.on("error", reject);
    child.on("close", (code: number) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`claude exited ${code}`)),
    );
  });
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

const HAIKU_INPUT_PER_MTOK = 0.8;
const HAIKU_OUTPUT_PER_MTOK = 4.0;
const SONNET_INPUT_PER_MTOK = 3.0;
const SONNET_OUTPUT_PER_MTOK = 15.0;

/** Rough token estimate: ~4 chars per token (industry rule-of-thumb). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function daemonActor() {
  return {
    user_id: "daemon",
    kind: "synapse-daemon" as const,
    device_id: "daemon",
    hostname: "daemon",
    client: "claude-code",
  };
}

export function recordRunStart(a: { project_id: string; purpose: string }): string {
  const run_id = Math.random().toString(36).slice(2);
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: "daemon",
    actor: daemonActor(),
    attached_to: null,
    kind: EventKind.DaemonRunStarted,
    occurred_at: new Date().toISOString(),
    payload: { run_id, purpose: a.purpose },
  });
  return run_id;
}

export function recordRunComplete(a: {
  project_id: string;
  run_id: string;
  input_tokens: number;
  output_tokens: number;
  model: "haiku" | "sonnet";
}): void {
  const inputRate = a.model === "haiku" ? HAIKU_INPUT_PER_MTOK : SONNET_INPUT_PER_MTOK;
  const outputRate = a.model === "haiku" ? HAIKU_OUTPUT_PER_MTOK : SONNET_OUTPUT_PER_MTOK;
  const cost_usd = (a.input_tokens / 1_000_000) * inputRate + (a.output_tokens / 1_000_000) * outputRate;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: "daemon",
    actor: daemonActor(),
    attached_to: null,
    kind: EventKind.DaemonRunCompleted,
    occurred_at: new Date().toISOString(),
    payload: {
      run_id: a.run_id,
      input_tokens: a.input_tokens,
      output_tokens: a.output_tokens,
      model: a.model,
      cost_usd,
    },
  });
}

export function getMonthlyCostUsd(): number {
  const dir = path.join(synapseRoot(), "projects");
  if (!fs.existsSync(dir)) return 0;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  let total = 0;
  for (const p of fs.readdirSync(dir)) {
    const events = readEvents(path.join(dir, p));
    for (const e of events) {
      if (e.kind === EventKind.DaemonRunCompleted && new Date(e.occurred_at).getTime() >= monthStart) {
        const payload = e.payload as { cost_usd?: number };
        total += payload.cost_usd ?? 0;
      }
    }
  }
  return total;
}
