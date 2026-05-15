import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

export function runPreCompactHook(a: { project_id: string; user_id: string; session_id: string }): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: null,
    kind: EventKind.ContextCompacted,
    occurred_at: new Date().toISOString(),
    payload: {},
  });
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}
