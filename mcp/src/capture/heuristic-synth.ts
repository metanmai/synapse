import { EventKind } from "@synapse/shared/handoff/events.js";
import type { Event } from "@synapse/shared/handoff/types.js";

/**
 * Compose a next-step sentence from local event signals when the LLM
 * inference path is unavailable. Never returns empty for non-empty input.
 */
export function synthesizeHeuristicNextStep(events: Event[]): string {
  if (events.length === 0) return "No recent activity to summarize.";

  const reversed = [...events].reverse();
  const latestFocus = reversed.find((e) => e.kind === EventKind.FocusSet);
  const latestPrompt = reversed.find((e) => e.kind === EventKind.UserPrompted);
  const latestCommit = reversed.find((e) => e.kind === EventKind.CommitMade);
  const latestBranch = reversed.find((e) => e.kind === EventKind.BranchSwitched);

  const subtasksOpen = aggregateOpenSubtasks(events);

  const focusText =
    (latestFocus?.payload.text as string | undefined) ?? (latestPrompt?.payload.prompt_excerpt as string | undefined);

  const parts: string[] = [];
  if (focusText) {
    parts.push(`Continue working on ${focusText.slice(0, 100)}.`);
  }
  if (subtasksOpen.length > 0) {
    const tail = subtasksOpen.length > 1 ? ` (then ${subtasksOpen.length - 1} more)` : "";
    parts.push(`Pick up ${subtasksOpen[0]}${tail}.`);
  }
  if (latestCommit) {
    const cp = latestCommit.payload as { sha?: unknown; message?: unknown };
    const sha = String(cp.sha ?? "").slice(0, 7);
    const msg = typeof cp.message === "string" ? cp.message : "";
    if (sha) parts.push(`Last commit: ${sha}${msg ? ` "${msg}"` : ""}.`);
  }
  if (latestBranch) {
    const bp = latestBranch.payload as { branch?: unknown };
    const branch = typeof bp.branch === "string" ? bp.branch : "";
    if (branch) parts.push(`Branch: ${branch}.`);
  }

  if (parts.length === 0) return "Recent activity recorded — see project status for details.";
  return parts.join(" ");
}

function aggregateOpenSubtasks(events: Event[]): string[] {
  const map = new Map<string, { text: string; state: "open" | "done" }>();
  for (const e of events) {
    if (e.kind === EventKind.SubtaskAdded) {
      const p = e.payload as { task_id?: unknown; text?: unknown };
      const id = String(p.task_id ?? e.event_id);
      const text = typeof p.text === "string" ? p.text : "";
      map.set(id, { text, state: "open" });
    } else if (e.kind === EventKind.SubtaskCompleted) {
      const p = e.payload as { task_id?: unknown };
      const id = String(p.task_id);
      const t = map.get(id);
      if (t) t.state = "done";
    }
  }
  return [...map.values()].filter((t) => t.state === "open").map((t) => t.text);
}
