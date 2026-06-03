import fs from "node:fs";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { renderBriefFromCache } from "../capture/handoff-brief.js";
import { projectDir, statusCachePath } from "../capture/handoff-paths.js";

const INJECTION_THRESHOLD_MS = 60 * 60 * 1000;

interface Args {
  project_id: string;
  user_id: string;
  session_id: string;
  prompt: string;
  stdout: NodeJS.WriteStream;
}

export function runUserPromptSubmitHook(a: Args): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const actor = resolveActor(a.user_id);
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor,
    attached_to: null,
    kind: EventKind.UserPrompted,
    occurred_at: new Date().toISOString(),
    payload: { prompt_excerpt: a.prompt.slice(0, 80) },
  });

  const injectPath = path.join(projectDir(a.project_id), "last_injection.txt");
  const last = fs.existsSync(injectPath) ? new Date(fs.readFileSync(injectPath, "utf-8").trim()).getTime() : 0;
  if (Date.now() - last < INJECTION_THRESHOLD_MS) return;

  if (!fs.existsSync(statusCachePath(a.project_id))) return;
  const brief = renderBriefFromCache(a.project_id, a.user_id);
  a.stdout.write(`<synapse-status-update>\n${brief}\n</synapse-status-update>\n`);
  fs.writeFileSync(injectPath, new Date().toISOString());
}
