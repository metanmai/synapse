import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

export function runPreCompactHook(a: {
  project_id: string;
  user_id: string;
  session_id: string;
  cwd?: string;
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

  // Background handoff pre-warm. The next session's SessionStart hook has
  // a 10s wall-clock budget on pull-compact — too tight for transcripts
  // larger than a few MB, where `claude -p` compaction takes 30-60s. If
  // we let SessionStart try to recompute inline, it times out and serves
  // a stale fallback handoff (often an OLDER session's content), which
  // is the bug "first session after /compact shows wrong context."
  //
  // Spawn `synapsesync pull-handoff` detached so it survives this hook's
  // process exit, runs the compaction in the background, and POSTs the
  // result to the backend conversation. By the time the user opens the
  // next session, the SessionStart hook gets a cache hit and returns
  // immediately with fresh content.
  //
  // Fire-and-forget; failures land in precompact-bg.log for diagnosis but
  // never block /compact (and the system still self-heals on the
  // session-after-next via pull-compact's normal flow).
  try {
    const cwd = a.cwd ?? process.cwd();
    const logFile = path.join(synapseRoot(), "precompact-bg.log");
    const out = fs.openSync(logFile, "a");
    // Resolve the synapsesync CLI entrypoint relative to THIS compiled file
    // so it works regardless of where dist is laid down (repo / npm-global).
    const distRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const cliEntry = path.join(distRoot, "index.js");
    const child = child_process.spawn(process.execPath, [cliEntry, "pull-handoff", "--cwd", cwd], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, SYNAPSE_PRECOMPACT_BG: "1" },
    });
    child.unref();
  } catch (err) {
    // Best-effort. If spawn fails (rare; would indicate FS or node binary
    // issues), the user just won't get the speedup — the system still
    // self-heals via pull-compact's normal flow on the next-but-one
    // SessionStart. Log so we can diagnose if it ever happens.
    try {
      fs.appendFileSync(
        path.join(synapseRoot(), "precompact-bg.log"),
        `[${new Date().toISOString()}] spawn FAILED: ${err instanceof Error ? err.message : err}\n`,
      );
    } catch {
      // truly nothing we can do
    }
  }
}
