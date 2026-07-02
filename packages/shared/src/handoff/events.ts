export const EventKind = {
  SessionOpened: "session_opened",
  SessionClosed: "session_closed",
  ToolUsed: "tool_used",
  FileTouched: "file_touched",
  CommitMade: "commit_made",
  BranchSwitched: "branch_switched",
  UserPrompted: "user_prompted",
  ContextCompacted: "context_compacted",
  SubtaskAdded: "subtask_added",
  SubtaskCompleted: "subtask_completed",
  IssueCreated: "issue_created",
  IssueStateChanged: "issue_state_changed",
  IssueNoted: "issue_noted",
  FocusSet: "focus_set",
  NextStepSet: "next_step_set",
  NextStepInferred: "next_step_inferred",
  DaemonRunStarted: "daemon_run_started",
  DaemonRunCompleted: "daemon_run_completed",
} as const;

export type EventKind = (typeof EventKind)[keyof typeof EventKind];
