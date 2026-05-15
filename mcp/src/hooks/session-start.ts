import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { briefCachePath, currentSessionPath, projectDir } from "../capture/handoff-paths.js";

export interface SessionStartArgs {
  project_id: string;
  user_id: string;
  stdout: NodeJS.WriteStream;
  skipFallback?: boolean;
}

export async function runSessionStartHook(args: SessionStartArgs): Promise<void> {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const session_id = `s_${Date.now().toString(36)}`;
  const actor = resolveActor(args.user_id);

  let brief = "";
  const bp = briefCachePath(args.project_id);
  if (fs.existsSync(bp)) {
    brief = fs.readFileSync(bp, "utf-8");
  } else if (!args.skipFallback) {
    brief = `Project: ${args.project_id}\n(no cached context — daemon will populate on next sync)`;
  }
  args.stdout.write(`<synapse-brief>\n${brief.trim()}\n</synapse-brief>\n`);

  appendEvent(projectDir(args.project_id), {
    project_id: args.project_id,
    session_id,
    actor,
    attached_to: null,
    kind: EventKind.SessionOpened,
    occurred_at: new Date().toISOString(),
    payload: { hostname: actor.hostname },
  });

  fs.mkdirSync(projectDir(args.project_id), { recursive: true });
  fs.writeFileSync(
    currentSessionPath(args.project_id),
    JSON.stringify({ session_id, started_at: new Date().toISOString() }),
  );
}
