import fs from "node:fs";
import path from "node:path";
import type { ProjectStatus } from "@synapse/shared/handoff/types.js";
import { briefCachePath, statusCachePath } from "./handoff-paths.js";

const MAX_BRIEF_LINES = 30;

export function renderBriefFromCache(project_id: string, viewer_user_id: string): string {
  const p = statusCachePath(project_id);
  if (!fs.existsSync(p)) {
    return `Project: ${project_id}\n(no cached context yet — daemon will populate on next sync)`;
  }
  const status: ProjectStatus = JSON.parse(fs.readFileSync(p, "utf-8"));
  return render(status, viewer_user_id);
}

function render(s: ProjectStatus, viewer: string): string {
  const lines: string[] = [];
  lines.push(`Project: ${s.project_id}`);
  if (s.current_next_step) {
    const provenance = s.current_next_step.inferred
      ? "inferred from activity"
      : `set by ${s.current_next_step.set_by.user_id}`;
    lines.push(`Next step (${provenance}): "${s.current_next_step.text}"`);
  }
  const mostRecent = s.active_actors[0];
  if (mostRecent) {
    const focus = mostRecent.current_focus ?? "(no focus)";
    const branch = mostRecent.branch ?? "(no branch)";
    if (mostRecent.actor.user_id === viewer) {
      lines.push(`Your last activity: ${focus} on ${branch}`);
    } else {
      lines.push(
        `Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state}): ${focus} on ${branch}`,
      );
    }
  }
  if (s.open_subtasks.length > 0) {
    lines.push(`Open subtasks: ${s.open_subtasks.slice(0, 5).map((t) => `[${t.text}]`).join(", ")}`);
  }
  if (s.open_issues.questions.length > 0) {
    lines.push(
      `Open questions: ${s.open_issues.questions.slice(0, 3).map((q) => `#${q.number} ${q.title}`).join("; ")}`,
    );
  }
  return lines.slice(0, MAX_BRIEF_LINES).join("\n");
}

export function writeBrief(project_id: string, viewer_user_id: string): void {
  const brief = renderBriefFromCache(project_id, viewer_user_id);
  const dest = briefCachePath(project_id);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, brief);
}
