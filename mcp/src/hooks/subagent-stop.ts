import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { projectDir } from "../capture/handoff-paths.js";

export function runSubagentStopHook(a: {
  project_id: string;
  user_id: string;
  session_id: string;
  subagent: string;
  git_basename?: string;
  git_remote_url?: string;
}): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: null,
    kind: EventKind.ToolUsed,
    occurred_at: new Date().toISOString(),
    // Routing payload — see pre-compact.ts for full motivation.
    payload: {
      tool: "Agent",
      subagent: a.subagent,
      ...(a.git_basename ? { git_basename: a.git_basename } : {}),
      ...(a.git_remote_url ? { git_remote_url: a.git_remote_url } : {}),
    },
  });
}
