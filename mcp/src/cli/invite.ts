import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "./config.js";
import { readProjectMap } from "./project-map.js";

export interface InviteArgs {
  email: string;
  project_id?: string;
}

interface InviteResponse {
  token: string;
  join_url: string;
  expires_at: string;
}

interface SynapseConfig {
  api_key?: string;
}

function readApiKey(): string {
  const root = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  const configPath = path.join(root, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as SynapseConfig;
      if (c.api_key) return c.api_key;
    } catch {
      /* fall through */
    }
  }
  const envKey = process.env.SYNAPSE_API_KEY;
  if (envKey) return envKey;
  throw new Error("no API key configured — run `synapse init` first or set SYNAPSE_API_KEY");
}

function resolveProjectIdFromCwd(cwd: string): string | undefined {
  try {
    const map = readProjectMap();
    return map[cwd]?.project_id;
  } catch {
    return undefined;
  }
}

/**
 * Mint a project invite. `--project <id>` overrides cwd resolution. Prints the
 * join URL the inviter can hand to the recipient until server-side email
 * delivery lands (deferred post-v1.1).
 */
export async function runInviteCmd(a: InviteArgs): Promise<void> {
  const api_key = readApiKey();
  const project_id = a.project_id ?? resolveProjectIdFromCwd(process.cwd());
  if (!project_id) {
    throw new Error("no project — run from a tracked project directory or pass --project <id>");
  }

  const res = await fetch(`${API_URL}/api/projects/${project_id}/invites`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${api_key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: a.email }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`invite failed: ${res.status}${text ? ` — ${text}` : ""}`);
  }
  const body = (await res.json()) as InviteResponse;
  process.stdout.write(`Invited ${a.email}.\n`);
  process.stdout.write(`Send them this link: ${body.join_url}\n`);
  process.stdout.write(`Expires: ${body.expires_at}\n`);
}
