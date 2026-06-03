import { EventKind } from "@synapse/shared/handoff/events.js";
import type { EventKind as Kind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { projectDir } from "../capture/handoff-paths.js";

interface Args {
  project_id: string;
  user_id: string;
  session_id: string;
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  git_basename?: string;
  git_remote_url?: string;
}

export function runPostToolUseHook(a: Args): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const actor = resolveActor(a.user_id, "human", "claude-code");
  const base = {
    project_id: a.project_id,
    session_id: a.session_id,
    actor,
    attached_to: null,
    occurred_at: new Date().toISOString(),
  };
  const dir = projectDir(a.project_id);

  // Routing fields — appended to every event's payload below. See
  // pre-compact.ts for full motivation. Each event flushed to
  // /api/events/batch needs git_basename + git_remote_url so the
  // backend's cwd_<hash> → canonical-uuid remap doesn't fall back to
  // "untitled" when this batch lacks a SessionStart event.
  const routing: Record<string, string> = {
    ...(a.git_basename ? { git_basename: a.git_basename } : {}),
    ...(a.git_remote_url ? { git_remote_url: a.git_remote_url } : {}),
  };

  const events: Array<{ kind: Kind; payload: Record<string, unknown> }> = [];

  if (a.tool === "Edit" || a.tool === "Write" || a.tool === "MultiEdit") {
    const p = String(a.input.file_path ?? a.input.path ?? "");
    if (p) {
      events.push({
        kind: EventKind.FileTouched,
        payload: { path: p, operation: a.tool === "Write" ? "create" : "edit" },
      });
    }
  } else if (a.tool === "TaskCreate") {
    const taskOutput = a.output as { taskId?: string };
    events.push({
      kind: EventKind.SubtaskAdded,
      payload: {
        text: String(a.input.subject ?? ""),
        task_id: String(taskOutput?.taskId ?? ""),
      },
    });
  } else if (a.tool === "TaskUpdate" && (a.input as { status?: string })?.status === "completed") {
    events.push({
      kind: EventKind.SubtaskCompleted,
      payload: { task_id: String((a.input as { taskId: string }).taskId) },
    });
  } else if (a.tool === "Bash") {
    const cmd = String((a.input as { command?: string }).command ?? "");
    const stdout = String((a.output as { stdout?: string })?.stdout ?? "");
    events.push({
      kind: EventKind.ToolUsed,
      payload: { tool: "Bash", cmd_summary: cmd.slice(0, 120) },
    });
    const commitMatch = stdout.match(/\[[\w-]+\s+([a-f0-9]{6,40})\]/);
    if (/^git\s+commit/.test(cmd.trim()) && commitMatch) {
      events.push({
        kind: EventKind.CommitMade,
        payload: {
          sha: commitMatch[1],
          message: cmd.match(/-m\s+['"]([^'"]+)['"]/)?.[1] ?? "",
        },
      });
    }
    const switchMatch = stdout.match(/Switched to (?:a new )?branch '([^']+)'/);
    if (switchMatch) {
      events.push({ kind: EventKind.BranchSwitched, payload: { branch: switchMatch[1] } });
    }
  } else {
    events.push({ kind: EventKind.ToolUsed, payload: { tool: a.tool } });
  }

  for (const e of events) appendEvent(dir, { ...base, ...e, payload: { ...e.payload, ...routing } });
}
