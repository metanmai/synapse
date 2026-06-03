# Synapse — Claude Code Handoff Layer (v1 Design)

**Date:** 2026-05-11
**Author:** Tanmai (with Claude)
**Status:** Implemented (v1.0.0) — see plan 2026-05-11
**Scope:** v1 of Synapse repositioned as a collaboration layer for Claude Code, primary scenario *handoff* (B2).

---

## 1. Goal

Make session-to-session and teammate-to-teammate handoff in Claude Code feel automatic. A developer who closes their laptop in the middle of work should be able to resume at any time — themselves the next morning, or a teammate later that day — with full context already loaded in the next session, without anyone having to write or read summaries by hand.

### 1.1 Anchor scenario (B2 — Handoff)

> Tanmai works on an OAuth callback all Monday morning. He walks away for the day. Tuesday morning Alex opens Claude Code on the same project and his first session is already oriented — knows what Tanmai was doing, what was left undone, what decisions were made, and what the explicit "next step" was. Alex picks up the work without anyone briefing him.

### 1.2 Scenarios that fall out for free

- **B1 (Onboarding)** — a teammate joining the project for the first time gets the same project context as a return-from-lunch user. Different brief framing, same underlying data.
- **B4 (Decision capture)** — decisions made in a session are typed records that other sessions can read before acting.

### 1.3 Out of scope (deferred)

- **B3 (Real-time parallel awareness)** — sub-second visibility into what another live session is doing. Requires WebSockets/SSE, presence, soft-locks. v1 polls every ~15s, which is enough for handoff but not for live conflict avoidance.
- **MCP as the primary integration surface.** MCP remains a legacy adapter for non-Claude-Code hosts; it is no longer the documented happy path for the Claude Code workflow. The npm package may be renamed accordingly.
- **Daemon-fired Claude Code runs beyond `next_step_hint` inference.** Decision extraction, digests, onboarding summary generation, etc., are v1.5+.
- **Full multi-host (Cursor/Windsurf/VS Code MCP) feature parity.** Claude Code is the v1 target.
- **Sophisticated conflict resolution beyond last-writer-wins.** No CRDTs, no manual merge UI.

---

## 2. Architecture

### 2.1 Component map

```
┌─────────────────────────────────────────────────┐
│              Claude Code (host)                 │
│                                                 │
│   hooks (bash)              Bash tool           │
│   ─────────────             ──────────          │
│   SessionStart      ┐       synapse <cmd>       │
│   UserPromptSubmit  │            │              │
│   PostToolUse       │            │              │
│   PreCompact        │            │              │
│   Stop / SessionEnd │            │              │
│   SubagentStop      │            │              │
│         │           │            │              │
│         │ append    │ inject     │              │
│         ▼           │ brief      │              │
│   ~/.synapse/projects/<pid>/                    │
│   ├─ events.jsonl   ◄────────────┤              │
│   ├─ current_session.json                       │
│   └─ cache/                                     │
│      ├─ project_status.json                     │
│      ├─ recent_issues.json                      │
│      └─ brief.md                                │
└──────────────┬──────────────────────────────────┘
               │
               ▼
       ┌─────────────────┐
       │ Capture daemon  │  always-on OS user service
       │ (extended)      │  push + pull + watchdog + optional CC-fire
       └────────┬────────┘
                │ HTTPS
                ▼
       ┌─────────────────┐
       │ Synapse API     │  Cloudflare Workers
       │ (new endpoints) │  reducer: events → ProjectStatus
       └─────────────────┘
```

### 2.2 The architectural commitments

- **Hooks are observers; CLI is for deliberate actions.** Hooks fire automatically on lifecycle events and produce *observed* events. The `synapse` CLI is invoked deliberately (by a human, or by an agent via Bash) for *authored* changes (`synapse handoff "..."`, `synapse issue create ...`). Mixing these on one write path is rejected.
- **Local-first, eventually consistent.** Hooks write to a local append-only log; the daemon syncs to remote in the background. Hooks never block on the network. Worst-case staleness across devices is ~15s (poll interval) + RTT.
- **The daemon is the network boundary.** Hooks do not make HTTPS calls. The CLI does, but the CLI is only invoked deliberately and tolerates latency. All routine traffic flows through the daemon.
- **MCP is de-scoped from the v1 critical path.** Reads and writes that the agent performs in-session go through the CLI (via Bash) or via context injection from hooks. The MCP server remains available as a `synapse mcp-serve` subcommand for non-CC hosts and the existing dashboard surface.

---

## 3. Data model

### 3.1 GitHub-shaped envelope

All addressable objects share one envelope, kind-discriminated where needed:

```ts
type GHObject = {
  id: string                  // ULID
  number: number              // project-local sequential (issue #12)
  type: "session" | "issue"
  title: string
  body: string                // markdown
  state: string               // type-specific values
  author: Actor
  assignees: Actor[]
  labels: string[]
  references: Reference[]
  timeline: Event[]
  created_at: timestamp
  updated_at: timestamp
  closed_at: timestamp | null
}
```

### 3.2 `Project`

```ts
Project {
  id: string
  slug: string
  description: string
  members: Member[]
  default_focus: string | null
  updated_at: timestamp
}
```

### 3.3 `ProjectStatus` — the live read target

The materialized rollup of "what is happening on this project right now." This is what the brief reads from. Sessions and events are the source; `ProjectStatus` is the view.

```ts
ProjectStatus {
  project_id: string
  current_next_step: {
    text: string
    set_by: Actor
    set_at: timestamp
    inferred: boolean        // true if daemon-generated, not authored
  } | null
  active_actors: Array<{
    actor: Actor
    current_focus: string | null
    branch: string | null
    last_event_at: timestamp
    activity_state: "active" | "idle"  // idle = no events for >30 min
    recent_files: FileTouch[]
  }>
  recent_activity: Event[]        // last ~24h, summarized
  open_issues: { decisions: Issue[], questions: Issue[] }
  open_subtasks: Subtask[]
}
```

### 3.4 `Session` — partition key, not user-facing

Sessions are the source-of-events grouping. They are mostly invisible to the user. They exist so the reducer can attribute events ("Tanmai's session-7 did these things") and so the dashboard can show per-session timelines.

```ts
Session {
  id: string
  number: number              // project-local
  project_id: string
  actor: Actor
  state: "open" | "closed"    // "open" until /clear, /exit, or explicit close
  branch_at_start: string | null
  base_commit: CommitRef | null
  started_at: timestamp
  last_event_at: timestamp
  closed_at: timestamp | null
}
```

Sessions are **never** the unit a user reads. They are diagnostic / audit.

### 3.5 `Issue` — unified Decision + Question

One type, `kind`-discriminated. Single `body` field; type-specific specialization is minimal. Follows the `TaskCreate` precedent of restraint.

```ts
Issue extends GHObject {
  type: "issue"
  kind: "decision" | "question"  // extensible later (bug, discussion, etc.)
  state: "open" | "resolved" | "superseded"
  body: string                    // markdown — holds rationale (decision) or answer (question)
  superseded_by: Ref<Issue> | null
  resolved_by: Actor | null
  originated_in_session: Ref<Session> | null
}
```

### 3.6 `Subtask` — embedded checklist

Not a top-level object. Lives inside the body of a Session or Issue as a markdown checklist; the reducer extracts them for `ProjectStatus.open_subtasks`.

```ts
Subtask {
  id: string
  text: string
  state: "open" | "done"
  parent: Ref<Session> | Ref<Issue>
  done_at: timestamp | null
  done_by: Actor | null
}
```

### 3.7 `Actor`

```ts
Actor {
  user_id: string
  kind: "human" | "synapse-daemon"
  device_id: string             // stable per machine
  hostname: string              // display only
  client: "claude-code" | string
}
```

The `kind: "synapse-daemon"` marker is what hooks check to skip recursive triggering when the daemon fires Claude Code itself.

### 3.8 `Event` — the source of truth

Append-only. Reducer plays events in `occurred_at` order (with `received_at` fallback for clock skew). Idempotent on `event_id` (ULID).

```ts
Event {
  event_id: ulid
  project_id: string
  session_id: string
  actor: Actor
  attached_to: Ref<Session> | Ref<Issue> | null
  kind: EventKind
  occurred_at: timestamp        // client-set
  received_at: timestamp        // server-set
  payload: object               // shape depends on kind
}

EventKind =
  // Session lifecycle
  | "session_opened" | "session_closed"
  // Observed work
  | "tool_used" | "file_touched" | "commit_made" | "branch_switched"
  | "user_prompted" | "context_compacted"
  // Subtasks
  | "subtask_added" | "subtask_completed"
  // Issues (authored, via CLI)
  | "issue_created" | "issue_state_changed" | "issue_noted"
  // Project-level mutable fields
  | "focus_set" | "next_step_set" | "next_step_inferred"
  // Daemon
  | "daemon_run_started" | "daemon_run_completed"
```

---

## 4. Data flow — the primary happy path

### 4.1 Monday 9:00 AM, Tanmai opens Claude Code

```
T+0ms     SessionStart hook fires
          ├─ reads cache/brief.md (rendered by daemon, last refresh <30s ago)
          ├─ prints <synapse-brief>...</synapse-brief> to stdout
          ├─ appends {kind: "session_opened", session_id, actor, project_id} to events.jsonl
          ├─ writes current_session.json
          └─ exits

T+50ms    Daemon notices new event via fs-watch
          ├─ POSTs /api/events/batch → server reducer creates Session row
          ├─ GETs /api/projects/<pid>/status → fresh ProjectStatus
          └─ rewrites cache/* (including brief.md for next start)
```

### 4.2 9 AM – 11 AM — Tanmai works

Every tool call → `PostToolUse` hook → one event appended:

```
Edit → file_touched
Bash → tool_used (+ commit_made if git commit, + branch_switched if checkout)
TaskCreate → subtask_added
TaskUpdate(completed) → subtask_completed
```

UserPromptSubmit → `user_prompted` event (first 80 chars of prompt feed `current_focus` heuristic).

Daemon batches every 10s, pushes to API. Reducer updates ProjectStatus. Cache refreshes.

### 4.3 10:30 AM — PreCompact

```
PreCompact hook:
  ├─ append {kind: "context_compacted", session_id, summary_at_compact}
  └─ touch ~/.synapse/daemon-flush-now → daemon flushes within ~50ms
```

Snapshot is on the server before compaction wipes the live window.

### 4.4 11 AM – 2 PM — Tanmai goes to lunch

Terminal stays open. No `SessionEnd` fires. After 30 min of no events for tanmai, daemon marks his `active_actors` entry as `activity_state: "idle"`.

### 4.5 2 PM — Tanmai returns, types first prompt

```
UserPromptSubmit hook:
  ├─ append {kind: "user_prompted", prompt_excerpt}
  ├─ checks last brief/status-update injection time
  └─ if gap > 60 min OR teammate activity since last injection:
       prepend <synapse-status-update>...</synapse-status-update> to the prompt
       containing recent deltas (teammate commits, new decisions, etc.)
```

Tanmai's agent stays oriented despite the long session.

### 4.6 5 PM — Tanmai sets explicit handoff

```
$ synapse handoff "wire /callback to user repo; tests pass at HEAD"
```

→ appends `{kind: "next_step_set", text, actor: tanmai, project_id}` and flushes immediately. Reducer updates `ProjectStatus.current_next_step` (with `inferred: false`).

### 4.7 5 PM – Tuesday 9 AM — Tanmai inactive

Daemon notices no events from tanmai for 30 min. If `daemon.ai_enabled = true` and no explicit `next_step_set` was made within the idle window:

```
Daemon spawns: claude -p "<prompt>" \
   --config ~/.synapse/daemon-cc-profile.json \
   --max-turns 1
Env: SYNAPSE_DAEMON_SESSION=1
Prompt summarizes last ~30 events; asks for one-sentence next-step hint.
Output is captured and written as {kind: "next_step_inferred", text, actor: synapse-daemon-on-behalf-of: tanmai}.
```

Since Tanmai *did* run `synapse handoff` at 5 PM, the daemon skips this — explicit > inferred.

### 4.8 Tuesday 9 AM — Alex opens Claude Code

First time on this project on this machine:

```
T+0ms     SessionStart hook fires
          ├─ reads cache/brief.md (DOES NOT EXIST — first ever)
          ├─ fallback: synchronously runs `synapse brief --actor alex` (~500ms)
          ├─ prints brief, appends session_opened
          └─ exits

T+50ms    Daemon initializes project dir, pulls ProjectStatus, writes cache/*
          From now on, SessionStart on Alex's machine is fast-path (<10ms).
```

Alex's brief:

```
<synapse-brief>
Project: synapse — current focus: v1 handoff layer

Most recent activity (Tanmai, idle since 5:13 PM yesterday on feature/oauth)
  Focus: OAuth callback wiring
  Next step (set by Tanmai): "wire /callback to user repo; tests pass at HEAD"
  Open subtasks: [wire route, write callback test]
  Open question: #4 — PKCE flag for mobile?

You haven't worked in this project before — say "show me around" for orientation.
</synapse-brief>
```

Alex picks up work. His events flow. Daemon syncs. The cycle repeats.

---

## 5. Component contracts

### 5.1 Hooks

All hooks installed via `synapse init` into `~/.claude/settings.json`. Each hook:
- Is a bash/node command run by Claude Code at the specified lifecycle event.
- Completes in <50ms in the steady-state path.
- Performs a single append to `~/.synapse/projects/<pid>/events.jsonl` (`O_APPEND` for safe concurrent writes from subagents).
- Wraps its logic in `try { ... } catch { exit 0 }` — never blocks the session.
- Checks `SYNAPSE_DAEMON_SESSION` env var; if set, skips or runs an observer-only path (to prevent recursion when the daemon fires CC).
- Chains correctly with any existing hook the user has configured (the chain pattern from `bf6a0c3`).

Hooks installed in v1:

| Hook | Event emitted | Special behavior |
|---|---|---|
| `SessionStart` | `session_opened` | Also reads `cache/brief.md` and prints `<synapse-brief>` to stdout |
| `UserPromptSubmit` | `user_prompted` | Checks gap-since-last-injection; if exceeded, prepends `<synapse-status-update>` |
| `PostToolUse` | one of `tool_used` / `file_touched` / `commit_made` / `branch_switched` / `subtask_added` / `subtask_completed` | Tool-name-routed extraction logic |
| `PreCompact` | `context_compacted` | Touches `daemon-flush-now` signal file |
| `SessionEnd` | `session_closed` | Triggers daemon final-flush for that session |
| `SubagentStop` | `tool_used` w/ payload describing subagent | Subagent-aware attribution |

`Stop` is **not installed in v1.** It fires after every assistant turn and would generate high-volume low-signal events. Reserved for v1.5+ if continuous telemetry needs it.

### 5.2 Daemon

Always-on OS user service. Installed and registered by `synapse init`:
- macOS: `launchd` plist in `~/Library/LaunchAgents/`
- Linux: `systemd --user` unit in `~/.config/systemd/user/`
- Windows: Startup Service entry

Responsibilities:

1. **Event flusher** — tails `events.jsonl` for every tracked project. Batches new events ~10s or 50-events-whichever-first. POSTs to `/api/events/batch`. Maintains `last_pushed_event_id` watermark; on restart picks up from there. Retries with exponential backoff on failure; never drops.
2. **Snapshot puller** — every ~15s per active project (and on demand via `daemon-pull-now` signal), GETs `/api/projects/<pid>/status` and `/api/projects/<pid>/events?since=<last_pulled_event_id>`. Replays into local materialized view. Rewrites `cache/*`.
3. **Brief renderer** — pure function `(ProjectStatus, actor) → markdown`. Writes to `cache/brief.md` so SessionStart is fast.
4. **Idle detector** — flags actors as `activity_state: "idle"` after 30 min of no events.
5. **Watchdog** — touches `~/.synapse/daemon.healthcheck` every 10s. SessionStart hook checks staleness; if >60s, prints "daemon-stale" banner.
6. **Daemon-fired CC (opt-in, v1)** — when an actor goes idle without an explicit `next_step_set`, spawns `claude -p "..."` (Haiku, max 1 turn) sandboxed via a daemon profile, captures output, writes `next_step_inferred` event. Respects `daemon.monthly_budget_usd`.

### 5.3 CLI (`synapse`)

| Command | Purpose |
|---|---|
| `synapse init` | First-run setup: writes hooks to `~/.claude/settings.json`, installs daemon service, prompts for API key, writes `~/.synapse/config` |
| `synapse status` | One-line health: daemon running, projects tracked, last push/pull |
| `synapse doctor` | Verbose diagnostics: queued events, errors, daemon uptime, cost since last reset |
| `synapse brief [--actor X]` | Renders the brief inline (used as fallback when cache is missing; can be invoked by humans for inspection) |
| `synapse handoff "<text>"` | Authored `next_step_set` — explicit handoff breadcrumb |
| `synapse set-focus "<text>"` | Authored `focus_set` — overrides the prompt-derived heuristic |
| `synapse issue create --kind {decision\|question} --title "..." [--body "..."]` | Authored `issue_created` |
| `synapse issue resolve <num> "<resolution>"` | Authored `issue_state_changed` to resolved |
| `synapse issue supersede <num> --by <new_num>` | Authored `issue_state_changed` to superseded |
| `synapse note <object_ref> "<text>"` | Authored `issue_noted` — comment on any object |
| `synapse search "<query>"` | Returns matching issues / sessions / events |
| `synapse mcp-serve` | (optional, legacy) starts MCP server for non-CC hosts |
| `synapse settings get/set <key> [value]` | Manage `daemon.ai_enabled`, `daemon.monthly_budget_usd`, etc. |

Slash command `/synapse-handoff` is bundled and wraps `synapse handoff`.

### 5.4 Backend (Synapse API)

New endpoints (REST, behind existing Bearer auth):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/events/batch` | Bulk event ingest; reducer updates SessionContext + ProjectStatus; idempotent on `event_id` |
| `GET` | `/api/projects/:id/status` | Returns ProjectStatus + recent issues |
| `GET` | `/api/projects/:id/events?since=<event_id>&limit=N` | Incremental pull for daemon |
| `GET` | `/api/projects/:id/sessions` | Paginated session list (for dashboard) |
| `GET` | `/api/projects/:id/issues` | Paginated issue list (filterable by kind/state) |
| `POST` | `/api/projects/:id/sessions/:sid/close` | Mark session closed (called by SessionEnd-triggered daemon flush) |

The reducer (`events → ProjectStatus`) is a pure server-side function. Deterministic. Replayable. Tested in isolation.

---

## 6. Conflict resolution

**Policy: last-writer-wins by `occurred_at`, with full audit trail.** No CRDT machinery. Works because the schema is dominated by append-only events and the truly mutable fields are tiny.

| Concurrent change | Resolution |
|---|---|
| Two devices append events | No conflict — log is commutative |
| Two actors set `current_focus` | LWW by `occurred_at`; both events visible in timeline |
| Two actors set `current_next_step` | LWW; brief shows `set_by` and `set_at` for transparency |
| Two actors complete the same subtask | First-completion-wins (idempotent on subtask_id) |
| Two actors edit the same issue body | LWW on whole body (rare; agent-initiated) |
| Two actors create what looks like the same issue | Both exist; manual merge available post-v1 |
| Two actors transition an issue's state | LWW on state; timeline preserves both attempts |
| Clock skew | Server uses `received_at` when `occurred_at` is implausible (>5 min in the future) |
| Offline-then-replay | Events sync with original `occurred_at`; eventual consistency; brief stale during gap |

---

## 7. Daemon-fired Claude Code (v1 scope)

### 7.1 What ships in v1

**Just one use case:** auto-generate `next_step_hint` after 30 min of actor idle, when no explicit `next_step_set` was issued within the idle window. Opt-in via `daemon.ai_enabled` (default OFF).

### 7.2 Sandbox profile

The daemon writes a dedicated CC profile at `~/.synapse/daemon-cc-profile.json` that:
- Disables Edit, Write, Bash, NotebookEdit, all file-mutating tools.
- Restricts Synapse access to read-only event log plus a single allowed write (the `next_step_inferred` event).
- Disables web fetches and external tools.
- Uses Haiku by default.

### 7.3 Loop prevention

The daemon spawns `claude -p` with env `SYNAPSE_DAEMON_SESSION=1`. Every hook checks this env var first; if set, hooks run in observer-only mode (write `daemon_run_*` events for cost tracking, skip everything else). The reducer ignores events from `actor.kind = "synapse-daemon"` when computing idle thresholds (so a daemon run doesn't reset the idle clock).

### 7.4 Cost controls

- `daemon.ai_enabled: bool` (default false)
- `daemon.monthly_budget_usd: number` (default $5)
- `daemon.model: "haiku" | "sonnet"` (default haiku)
- Daemon writes `daemon_run_started` / `daemon_run_completed` events with estimated cost
- `synapse status` shows cumulative cost since last reset
- When budget hit, sync continues; AI runs stop until next month or manual reset

### 7.5 Provenance in the brief

Inferred `next_step_hint`s are rendered with explicit provenance:

```
Next step (inferred from activity): "wire /callback to user repo"
```

vs. authored:

```
Next step (set by Tanmai): "wire /callback to user repo; tests pass at HEAD"
```

The `inferred: true` label is non-negotiable — masking it would create fake-statement problems.

### 7.6 Out of scope for v1 (planned for v1.5)

- Decision extraction from event streams
- Periodic project digests / weekly summaries
- Onboarding-tailored summaries for new actors
- Periodic `current_focus` refresh
- Semantic conflict resolution

---

## 8. Error handling & failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Daemon not running | Hooks still write locally; brief is stale | SessionStart prints "daemon-stale" banner; `synapse doctor` reports it; service manager auto-restarts |
| Network down | Daemon retries with backoff; local events accumulate | Local cache still serves reads; events flush on reconnect |
| Backend rejects an event | Daemon logs, quarantines bad event | Visible in `synapse doctor`; doesn't block other events |
| Hook script throws | Single hook fails; rest of session continues | Hooks wrap in `try { ... } catch { exit 0 }`; never block |
| Local cache missing (first session on new machine) | SessionStart calls `synapse brief` synchronously as fallback | ~500ms one-time cost; fast path thereafter |
| Two devices, same user | Two `device_id`s, both contribute events | Reducer dedupes `active_actors` by `user_id`; brief shows both hostnames if simultaneously active |
| Daemon-fired CC budget hit | AI runs pause | Sync continues; user warned in `synapse status` |
| Daemon-fired CC recursion | Hook detects `SYNAPSE_DAEMON_SESSION=1` | Observer-only path; no recursive trigger |
| Clock skew | `occurred_at` looks implausible | Server falls back to `received_at` |
| `events.jsonl` grows unbounded | Disk usage creeps up | Daemon rolls archives monthly: `events-archive-YYYY-MM.jsonl.gz` after server confirms ingest |

---

## 9. Testing strategy

| Layer | What to test | How |
|---|---|---|
| Reducer | events → ProjectStatus is deterministic | Pure-function tests with golden inputs/outputs |
| Brief formatter | renders correctly per actor (self vs. teammate, idle vs. active) | Snapshot tests with fixture data |
| LWW conflict policy | concurrent `current_focus` / `current_next_step` writes converge identically across event orderings | Property-based: shuffle event order, assert final state is identical |
| Hooks | each hook writes correct event shape, exits <50ms, never blocks on errors | Bash-level integration test with mocked events.jsonl |
| Daemon | flush + pull cycles, watermark recovery on restart, idempotency under retry | Spin up daemon against a stub backend; kill mid-flush; verify catch-up |
| End-to-end happy path | the literal "Tanmai-Monday → Alex-Tuesday" handoff scenario | Test harness simulates two devices against one backend; assert Alex's rendered brief contains Tanmai's handoff text |
| Daemon-fired CC | sandbox enforced (no Edit/Bash), loop prevention works, budget cap respected | Integration test with stub `claude` binary |
| Multi-device same-user | Events from two devices merged correctly under one `user_id` | Two stub daemons, one backend, assert one logical actor in brief |

---

## 10. Open questions / decisions log

### Decisions confirmed during brainstorming

1. **Anchor scenario is B2 (Handoff).** B1, B4 fall out; B3 deferred.
2. **Local-first event log with background daemon sync.** Rejected: direct hooks→API (latency), MCP-mediated (startup race).
3. **MCP de-scoped from v1 critical path.** Hooks + CLI cover Claude Code. MCP remains an optional adapter.
4. **GitHub-shaped schema.** Project / Session (partition) / Issue (unified, kind-discriminated) / Subtask (embedded) / Event.
5. **`Issue` is unified, not split into Decision + Question.** Single `body` field; `superseded_by` and `resolved_by` are the only type-specific top-level fields.
6. **`ProjectStatus` (not `SessionContext`) is the live read target.** Sessions are demoted to partition keys.
7. **`current_next_step` is project-level, settable by anyone.** Not session-scoped.
8. **Long-running sessions handled via `UserPromptSubmit` status-update injection** when idle/turn gap exceeds threshold.
9. **Always-on OS service (launchd/systemd/Windows Service).** Not `nohup &`.
10. **LWW conflict policy with audit trail.** No CRDTs in v1.
11. **Daemon-fired CC scoped to one use case in v1:** auto-generate `next_step_hint` after idle, opt-in, sandboxed, Haiku, budgeted.
12. **`inferred: true` provenance label in brief** is non-negotiable.

### Open for implementation phase

- Specific extraction logic for `current_focus` from `user_prompted` events (first-80-chars heuristic is v1, may improve later).
- Idle threshold default (currently 30 min — instrument to validate).
- Status-update injection threshold (currently 60 min wall-clock or 50 turns).
- Pull cadence (currently 15s).
- Exact prompt template for daemon-fired CC `next_step_inferred` generation.
- Brief token budget hard cap (currently ~600 tokens).
- npm package rename strategy (keep `synapsesync-mcp` for backwards compatibility, add new bin alias, or rename outright).
- Subtask ID assignment — subtasks come from markdown checklists in session/issue bodies; how is `id` derived so concurrent device writes converge to the same subtask record? (Options: content-hash, position-in-parent, server-issued on first observation. v1 implementation choice.)
- Whether `Stop` should ever be installed in a debounced form (e.g., one event per N turns) — current decision is no, but worth revisiting if `current_focus` heuristics aren't accurate enough from `UserPromptSubmit` alone.

---

## 11. v1 acceptance criteria

The following must all be true at v1 ship:

1. `synapse init` installs hooks, sets up the daemon as an OS service, and creates `~/.synapse/` in <30s on a fresh machine.
2. Opening Claude Code in a tracked project injects a `<synapse-brief>` in <100ms (assuming cache is warm) or <600ms first-time-on-machine fallback.
3. Hooks add <50ms latency to any single tool call.
4. A two-device, two-user handoff scenario (Tanmai Monday → Alex Tuesday) works end-to-end with no manual sync step. Alex's brief contains Tanmai's authored `next_step`.
5. The daemon survives a kill -9 mid-flush and resumes from its watermark with zero event loss on restart.
6. With `daemon.ai_enabled = true`, a 30-min idle period without explicit handoff produces an `inferred: true` next-step that appears in the next session's brief.
7. Daemon-fired CC runs cannot modify any file outside `~/.synapse/` (sandbox verified by tests).
8. `synapse doctor` accurately reports all failure modes from §8.
9. Test coverage: reducer ≥90%, brief formatter ≥90%, hooks ≥80%, E2E happy path automated.

---

## 12. Non-goals

For absolute clarity, v1 explicitly does NOT deliver:

- Sub-second presence / real-time co-editing awareness (B3)
- Conflict-resolution UI (manual merge of duplicate issues, body-level merging)
- Multi-host MCP feature parity beyond the legacy adapter
- Decision extraction, project digests, onboarding summary generation
- A polished dashboard for browsing issues/sessions (existing dashboard is sufficient)
- Mobile clients
- Self-hosting documentation updates (separate workstream)
- Migration of existing `save_insight` data to the new schema (covered in a separate transition spec)

---

## 13. Migration & compatibility

- `save_insight` continues to work for v1, marked as a deprecated path in docs. New writes are encouraged through the typed CLI commands.
- Existing MCP tools (`mcp__synapse__*`) continue to function for users who depend on them. The Claude Code happy path no longer requires them.
- Existing data (insights, conversations) is not migrated; it remains queryable through legacy endpoints.
- The npm package name (`synapsesync-mcp`) may be renamed in v1.x. v1 keeps the existing name with a binary alias `synapse` added.

---

## End of design.
