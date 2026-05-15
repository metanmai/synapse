import fs from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";

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
