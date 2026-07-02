import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

export function runPreCompactHook(a: {
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
    actor: resolveActor(a.user_id),
    attached_to: null,
    kind: EventKind.ContextCompacted,
    occurred_at: new Date().toISOString(),
    // Routing payload: backend's /api/events/batch remaps cwd_<hash> →
    // canonical project UUID via findOrCreateProjectByGit, which reads
    // git_basename + git_remote_url from the FIRST event in the batch
    // that's keyed by this cwdHash. If a batch contains no event with
    // git info, the remap falls back to "untitled" and the event is
    // misrouted. SessionStart was the only hook including these fields,
    // which created a race: when the daemon flushed PreCompact /
    // SessionEnd / etc. events AFTER the SessionStart batch was already
    // flushed (so its watermark advanced past it), the second batch had
    // no git info and got dumped into the untitled project. Including
    // these on every hook makes routing robust regardless of batch order.
    payload: {
      ...(a.git_basename ? { git_basename: a.git_basename } : {}),
      ...(a.git_remote_url ? { git_remote_url: a.git_remote_url } : {}),
    },
  });
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}
