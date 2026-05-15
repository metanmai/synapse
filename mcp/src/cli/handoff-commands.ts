import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

function signalFlush(): void {
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}

interface Base {
  project_id: string;
  user_id: string;
  session_id: string;
}

export async function runHandoffCmd(a: Base & { text: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: null,
    kind: EventKind.NextStepSet,
    occurred_at: new Date().toISOString(),
    payload: { text: a.text },
  });
  signalFlush();
}

export async function runSetFocusCmd(a: Base & { text: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: null,
    kind: EventKind.FocusSet,
    occurred_at: new Date().toISOString(),
    payload: { text: a.text },
  });
  signalFlush();
}

export async function runNoteCmd(a: Base & { target: string; text: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: parseRef(a.target),
    kind: EventKind.IssueNoted,
    occurred_at: new Date().toISOString(),
    payload: { target: a.target, text: a.text },
  });
  signalFlush();
}

function parseRef(s: string): { type: "session" | "issue" | "file" | "commit"; id: string } | null {
  const m = s.match(/^(session|issue|file|commit):(.+)$/);
  return m ? { type: m[1] as "session" | "issue" | "file" | "commit", id: m[2] } : null;
}

function issueId(): string {
  return `iss_${randomBytes(6).toString("hex")}`;
}

export async function runIssueCreate(
  a: Base & { kind: "decision" | "question"; title: string; body: string },
): Promise<void> {
  const id = issueId();
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: { type: "issue", id },
    kind: EventKind.IssueCreated,
    occurred_at: new Date().toISOString(),
    payload: { id, number: 0, kind: a.kind, title: a.title, body: a.body },
  });
  signalFlush();
}

export async function runIssueResolve(a: Base & { issue_id: string; resolution: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: { type: "issue", id: a.issue_id },
    kind: EventKind.IssueStateChanged,
    occurred_at: new Date().toISOString(),
    payload: { id: a.issue_id, state: "resolved", resolution: a.resolution },
  });
  signalFlush();
}

export async function runIssueSupersede(a: Base & { issue_id: string; superseded_by: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id,
    session_id: a.session_id,
    actor: resolveActor(a.user_id),
    attached_to: { type: "issue", id: a.issue_id },
    kind: EventKind.IssueStateChanged,
    occurred_at: new Date().toISOString(),
    payload: { id: a.issue_id, state: "superseded", superseded_by: a.superseded_by },
  });
  signalFlush();
}
