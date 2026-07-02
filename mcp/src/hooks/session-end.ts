import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

export function runSessionEndHook(a: {
  project_id: string;
  user_id: string;
  session_id: string;
  git_basename?: string;
  git_remote_url?: string;
}): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id, "human", "claude-code"),
    attached_to: null,
    kind: EventKind.SessionClosed,
    occurred_at: new Date().toISOString(),
    // Routing payload — see pre-compact.ts for full motivation. Every
    // event must carry git_basename + git_remote_url because the batch
    // remap on /api/events/batch picks them from the first event with
    // this cwdHash in the batch; if absent the remap falls back to
    // "untitled" and the event is misrouted.
    payload: {
      clean: true,
      ...(a.git_basename ? { git_basename: a.git_basename } : {}),
      ...(a.git_remote_url ? { git_remote_url: a.git_remote_url } : {}),
    },
  });
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}
