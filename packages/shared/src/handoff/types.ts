import type { EventKind } from "./events.js";

export interface Actor {
  user_id: string;
  kind: "human" | "synapse-daemon";
  device_id: string;
  hostname: string;
  client: string;
}

export interface CommitRef {
  sha: string;
  message: string;
}
export interface FileTouch {
  path: string;
  last_touched_at: string;
  operation: "edit" | "read" | "create" | "delete";
}
export interface Reference {
  type: "session" | "issue" | "file" | "commit";
  id: string;
}

export interface Event {
  event_id: string;
  project_id: string;
  session_id: string;
  actor: Actor;
  attached_to: Reference | null;
  kind: EventKind;
  occurred_at: string;
  received_at: string;
  payload: Record<string, unknown>;
}

export interface Subtask {
  id: string;
  text: string;
  state: "open" | "done";
  parent: Reference;
  done_at: string | null;
  done_by: Actor | null;
}

interface GHObject {
  id: string;
  number: number;
  title: string;
  body: string;
  author: Actor;
  assignees: Actor[];
  labels: string[];
  references: Reference[];
  timeline: Event[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Session extends GHObject {
  type: "session";
  project_id: string;
  state: "open" | "closed";
  branch_at_start: string | null;
  base_commit: CommitRef | null;
  started_at: string;
  last_event_at: string;
}

export interface Issue extends GHObject {
  type: "issue";
  kind: "decision" | "question";
  state: "open" | "resolved" | "superseded";
  superseded_by: Reference | null;
  resolved_by: Actor | null;
  originated_in_session: Reference | null;
}

export interface ProjectStatus {
  project_id: string;
  current_next_step: {
    text: string;
    set_by: Actor;
    set_at: string;
    inferred: boolean;
  } | null;
  active_actors: Array<{
    actor: Actor;
    current_focus: string | null;
    branch: string | null;
    last_event_at: string;
    activity_state: "active" | "idle";
    recent_files: FileTouch[];
  }>;
  recent_activity: Event[];
  open_issues: { decisions: Issue[]; questions: Issue[] };
  open_subtasks: Subtask[];
  updated_at: string;
}
